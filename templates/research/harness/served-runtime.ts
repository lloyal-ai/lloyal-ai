/**
 * The harness's edge/served compute substrate — the harness-FREE half.
 *
 * The per-session `SessionContext` factory + the `Runner` factories (edge + served),
 * split from the `Runner` *interface* ({@link ./runner-ctx}) and from the
 * harness-RUNNING `runServedSession` ({@link ./served-session}) so these factories
 * import neither the `harness` nor its `.eta` prompts — a web driver imports this
 * file (only `createServedContext`/`createServedChannels`) without pulling esbuild.
 *
 * Copied from reasoning.run's `served-runtime.ts`. A served host materialises one
 * `SessionContext` per admitted Session over one resident model; lloyal.node's
 * ModelRegistry weak-caches the model by path, so the Nth session shares the
 * resident weights + only allocates a fresh KV context. The reranker is NOT built
 * here — `provisionAbilityModels` (in `runServedSession` / the cli boot) loads it and
 * publishes it on `RerankerCtx`, so no factory here touches it.
 */
import { createSignal } from "effection";
import type { Signal } from "effection";
import { createContext as createNativeContext } from "@lloyal-labs/lloyal.node";
import type { SessionContext } from "@lloyal-labs/sdk";
import { NullTraceWriter } from "@lloyal-labs/lloyal-agents";
import type { TraceWriter } from "@lloyal-labs/lloyal-agents";
import { createBus, type EventBus } from "@lloyal-labs/binding";
import type { Runner } from "./runner-ctx.js";
import type { WorkflowEvent, Command } from "./protocol.js";
import type { Config, ConfigOrigin, ConfigPatch, SaveResult } from "./config-types.js";

/**
 * Steer the native backend for BOTH the resident model context AND the reranker
 * via `process.env.LLOYAL_GPU` (rig's `createReranker` exposes no loadOptions
 * passthrough). A configured backend is an EXPLICIT deploy request → fail loud on
 * an unavailable variant (`LLOYAL_NO_FALLBACK`, never overriding a user-set one)
 * instead of silently loading on CPU. With no gpu configured, any inherited
 * `LLOYAL_GPU` is CLEARED — config stays the sole source of truth.
 */
export function applyServedGpuEnv(cfg: Config): void {
  const gpu = cfg.model.gpu;
  if (gpu) {
    process.env.LLOYAL_GPU = gpu;
    if (process.env.LLOYAL_NO_FALLBACK === undefined) {
      process.env.LLOYAL_NO_FALLBACK = "1";
    }
  } else if (process.env.LLOYAL_GPU !== undefined) {
    delete process.env.LLOYAL_GPU;
  }
}

/**
 * Build one `SessionContext` over the resident model. Called once per admitted
 * Session (in the host's `materialise`); lloyal.node's ModelRegistry weak-caches
 * the model by path, so the Nth call shares the resident weights and only
 * allocates a fresh KV context.
 */
export function createServedContext(cfg: Config): Promise<SessionContext> {
  const modelPath = cfg.model.path;
  if (!modelPath) {
    throw new Error(
      "createServedContext: cfg.model.path is required (the host's resident model)",
    );
  }
  applyServedGpuEnv(cfg);
  return createNativeContext(
    {
      modelPath,
      nCtx: cfg.model.nCtx ?? 32768,
      nSeqMax: cfg.model.branches ?? 24,
      typeK: cfg.model.kvCache ?? "q4_0",
      typeV: cfg.model.kvCache ?? "q4_0",
    },
    cfg.model.gpu ? { gpuVariant: cfg.model.gpu } : undefined,
  );
}

/** Deep-merge a `saveConfig` patch into a config — the same nested-object merge
 *  the file loader used, but purely in-memory. */
function mergeConfig(base: Config, patch: ConfigPatch): Config {
  const sources = { ...base.sources, ...(patch.sources ?? {}) };
  const model = { ...base.model, ...(patch.model ?? {}) };
  if (sources.outputDir === "") delete sources.outputDir;
  return {
    ...base,
    ...patch,
    version: 1,
    sources,
    abilities: { ...base.abilities, ...(patch.abilities ?? {}) },
    defaults: { ...base.defaults, ...(patch.defaults ?? {}) },
    model,
  };
}

/**
 * Platform-owned observability, injected by the boot. The factories stay
 * binding-agnostic — no `node:fs`, no env reads — so a boot over a DIFFERENT
 * binding (a React Native shell over nitro-llama instead of lloyal.node) can
 * supply its own trace sink and dev signal without this file changing.
 * Omitted ⇒ Null sink, dev off: production behaviour needs no opts.
 */
export interface RunnerDevOpts {
  /** Where trace events land. The Node boots pass a `JsonlTraceWriter` under
   *  `LLOYAL_DEV=1`; omitted, the no-op writer. */
  traceWriter?: TraceWriter;
  /** The boot's dev signal — gates pool epistemics and the dev pane. */
  dev?: boolean;
}

/**
 * Boot-owned config plumbing, injected like the dev sink so the factories
 * stay platform-free. The boot that layered the config passes the computed
 * per-field `origin`, and — edge only — a `persist` that writes the patch to
 * `harness.json` and returns the re-layered provenance. Absent `persist`,
 * patches stay in-memory and their fields read `session`.
 */
export interface RunnerConfigOpts {
  origin: ConfigOrigin;
  persist?: (patch: ConfigPatch) => SaveResult & { config: Config; origin: ConfigOrigin };
}

/** Mark every origin-tracked field a patch touches as `session` — the honest
 *  provenance for an in-memory change that no file will remember. */
function markSession(origin: ConfigOrigin, patch: ConfigPatch): ConfigOrigin {
  const next = { ...origin };
  if (patch.sources && "outputDir" in patch.sources) next.outputDir = "session";
  if (patch.model?.path !== undefined) next.modelPath = "session";
  if (patch.model?.reranker !== undefined) next.reranker = "session";
  if (patch.model?.nCtx !== undefined) next.nCtx = "session";
  if (patch.model?.gpu !== undefined) next.gpu = "session";
  if (patch.defaults?.reasoningMode !== undefined) next.reasoningMode = "session";
  return next;
}

/**
 * Build the served `Runner` for ONE Session. Everything here is per-session: its
 * OWN config clone (in-memory `saveConfig`), fresh wind-down / cancel signals, and
 * its own injected trace sink — so no runner state and no user data crosses between tenants.
 * The reranker is NOT a Runner concern: `runServedSession`'s `provisionAbilityModels`
 * publishes a per-session reranker on `RerankerCtx` in the harness's scope.
 * `reloadRuntime` is a no-op: the model is a fixed host residency, so a /model or
 * /gpu change can't rebuild it — the harness's unconditional `return` after calling
 * it simply ends that Session.
 */
export function makeServedRunner(cfg: Config, opts: RunnerDevOpts & RunnerConfigOpts): Runner {
  let sessionConfig = structuredClone(cfg);
  let sessionOrigin = { ...opts.origin };
  const windDown = createSignal<void, void>();
  const cancelAgent = createSignal<{ agentId: number }, void>();
  return {
    config: () => sessionConfig,
    origin: () => sessionOrigin,
    saveConfig(patch) {
      // In-memory only — a shared server-side file would leak one tenant's
      // settings into another's. `path: null` says so; touched fields read
      // `session` in the origin.
      sessionConfig = mergeConfig(sessionConfig, patch);
      sessionOrigin = markSession(sessionOrigin, patch);
      return {
        path: null,
        gitignored: false,
        skipped: [],
        config: sessionConfig,
        origin: sessionOrigin,
      };
    },
    reloadRuntime(_patch: Partial<Config>) {
      // No-op — the model is a fixed host residency; it can't rebuild per Session.
    },
    windDown,
    cancelAgent,
    traceWriter: opts.traceWriter ?? new NullTraceWriter(),
    dev: opts.dev ?? false,
    replayCheckpoint: null,
    findingsMaxChars: undefined,
    mode: "interactive",
    initialQuery: undefined,
    isFirstIteration: true,
  };
}

/**
 * Build the CLI edge `Runner` — this template's edge substrate. `saveConfig`
 * evolves a private clone AND persists the patch through the boot-injected
 * `persist` (harness.json), so /output-dir and /effort survive restarts;
 * `reloadRuntime` persists too — the process ends after it, and the next
 * launch applies the change. The boot's injected trace sink, no replay,
 * `interactive` mode. The reranker is NOT here: the boot's
 * `provisionAbilityModels` publishes it on `RerankerCtx` before `harness` runs.
 */
export function makeEdgeRunner(cfg: Config, opts: RunnerDevOpts & RunnerConfigOpts): Runner {
  let sessionConfig = structuredClone(cfg);
  let sessionOrigin = { ...opts.origin };
  const windDown = createSignal<void, void>();
  const cancelAgent = createSignal<{ agentId: number }, void>();
  return {
    config: () => sessionConfig,
    origin: () => sessionOrigin,
    saveConfig(patch) {
      if (opts.persist) {
        // Live-read fields (sources, defaults, abilities) reconcile from the
        // re-layered files — value AND origin together, so clearing a key
        // restores the rung beneath it and an env-outranked save shows the
        // env value it actually runs with. The model block stays BOOT-FROZEN
        // (value and origin): it describes the RUNNING residency, which a
        // save cannot change — that is reloadRuntime + a relaunch.
        const saved = opts.persist(patch);
        sessionConfig = { ...saved.config, model: sessionConfig.model };
        sessionOrigin = {
          ...saved.origin,
          modelPath: sessionOrigin.modelPath,
          reranker: sessionOrigin.reranker,
          nCtx: sessionOrigin.nCtx,
          gpu: sessionOrigin.gpu,
        };
        return { ...saved, config: sessionConfig, origin: sessionOrigin };
      }
      sessionConfig = mergeConfig(sessionConfig, patch);
      sessionOrigin = markSession(sessionOrigin, patch);
      return {
        path: null,
        gitignored: false,
        skipped: [],
        config: sessionConfig,
        origin: sessionOrigin,
      };
    },
    reloadRuntime(patch: ConfigPatch) {
      // Persist the change; there is no in-process rebuild — the harness
      // returns after calling this and the process ends. The next launch
      // reads harness.json and applies it.
      opts.persist?.(patch);
    },
    windDown,
    cancelAgent,
    traceWriter: opts.traceWriter ?? new NullTraceWriter(),
    dev: opts.dev ?? false,
    replayCheckpoint: null,
    findingsMaxChars: undefined,
    mode: "interactive",
    initialQuery: undefined,
    isFirstIteration: true,
  };
}

/** Build a fresh per-session event bus + command signal. A web driver pairs this
 *  with {@link createServedContext} to satisfy the host's `materialise`. */
export function createServedChannels(): {
  uiChannel: EventBus<WorkflowEvent>;
  commands: Signal<Command, void>;
} {
  return {
    uiChannel: createBus<WorkflowEvent>(),
    commands: createSignal<Command, void>(),
  };
}
