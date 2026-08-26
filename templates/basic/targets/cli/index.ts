/**
 * The CLI target — where your harness runs in a terminal.
 *
 * Generated for you and rarely touched. It does three things: resolve the
 * resident model, pick a surface, and run your harness over it. The surface
 * pick is the whole "one harness, many targets" idea in miniature — the same
 * `harness(ctx, events, commands)` mounts on Ink (a terminal), `ipc` (when a
 * desktop shell forks this bin), or `ndjson` (a pipe), all over one binding.
 *
 * `basic`'s edge is a single boot: no config-reload / model-restart loop
 * (that's a product's elaboration). The model is a file in `models/<role>/`,
 * resolved from `harness.yml` and — on first run — fetched + digest-verified by
 * the platform (`rig.resolveModel`), with no API key. Drop your own `.gguf`
 * into `models/llm/` (or point `path:` at one) to skip the fetch entirely.
 */
import { closeSync, mkdirSync, openSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { main, call, ensure, createSignal } from "effection";
import { createBus } from "@lloyal-labs/binding";
import { ipc, ndjson } from "@lloyal-labs/binding/node";
import { NullTraceWriter, JsonlTraceWriter } from "@lloyal-labs/lloyal-agents";
import type { TraceWriter } from "@lloyal-labs/lloyal-agents";
import { createContext } from "@lloyal-labs/lloyal.node";
import { resolveModel, provisionAbilityModels } from "@lloyal-labs/rig/node";
import { makeEdgeRunner } from "@lloyal-labs/rig";
import { harness, abilities, RunnerCtx } from "../../harness/harness.js";
import { applyServedGpuEnv } from "../../harness/served-runtime.js";
import type { Command, WorkflowEvent } from "../../harness/protocol.js";
import { loadConfig, loadYml, saveLocalConfig, SESSION_ORIGIN_MAP } from "../../harness/config.js";
import type { HarnessYml } from "../../harness/config.js";
import type { Config, ConfigOrigin, ConfigPatch, LoadedConfig } from "../../harness/config-types.js";
import { renderCli } from "./view.js";

/** Best-effort file size for the boot header — a stat failure never blocks boot
 *  (the header size is cosmetic; the real model-load error surfaces on its own). */
function fileSize(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

/** The dev-gated trace sink: under `LLOYAL_DEV=1`, a `trace-<ts>-<id>.jsonl`
 *  in `sources.outputDir` (default: the project root) — the record the dev
 *  tools tail (the directory is created if missing). Otherwise Null:
 *  production writes nothing. The random id keeps
 *  concurrent writers apart and `"wx"` refuses to truncate an existing file; a
 *  failed open degrades to Null (tracing is observability, never a
 *  dependency). The caller owns the fd — `ensure(close)` it on its scope. */
function makeTraceWriter(cfg: Config, dev: boolean): { writer: TraceWriter; close: () => void } {
  if (!dev) return { writer: new NullTraceWriter(), close: () => {} };
  try {
    const dir = cfg.sources.outputDir ?? process.cwd();
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const fd = openSync(join(dir, `trace-${ts}-${randomUUID().slice(0, 8)}.jsonl`), "wx");
    return {
      writer: new JsonlTraceWriter(fd),
      close: () => {
        try {
          closeSync(fd);
        } catch {
          /* already closed */
        }
      },
    };
  } catch {
    return { writer: new NullTraceWriter(), close: () => {} };
  }
}

// The layered config: cli > env > harness.json > harness.yml > default. A bad
// manifest fails HERE — before any model fetch. `bootEnv` is snapshotted
// before `applyServedGpuEnv` writes LLOYAL_GPU, so re-layering after a save
// reads the user's env, never our own write.
const bootEnv = { ...process.env };
function loadOrExit(): { yml: HarnessYml; loaded: LoadedConfig } {
  try {
    const yml = loadYml();
    return { yml, loaded: loadConfig(yml, {}, bootEnv) };
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
const { yml, loaded } = loadOrExit();
const context = loaded.config.model.nCtx ?? 32768;

main(function* () {
  // The resident model — a file in models/llm/, fetched + digest-verified on
  // first run (no API key). rig owns the verified fetch; the boot just asks.
  let modelPath: string;
  let fetching = false;
  try {
    modelPath = yield* call(() =>
      resolveModel({
        projectRoot: process.cwd(),
        role: "llm",
        // A saved/yml `model.path` outranks the yml catalog id.
        spec: loaded.config.model.path
          ? { path: loaded.config.model.path }
          : { id: yml.model?.llm?.id },
        onProgress: (got, total) => {
          fetching = true;
          const pct = total > 0 ? Math.round((100 * got) / total) : 0;
          process.stderr.write(`\rfetching ${yml.model?.llm?.id ?? "model"} — ${pct}%   `);
        },
      }),
    );
  } catch (err) {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  if (fetching) process.stderr.write("\n");

  // Which surface is mounting — decided once, here, then echoed into the boot
  // header (as a measured fact) and used to pick the binding below.
  const surface = process.env.RR_BRIDGE ? "desktop" : process.stdout.isTTY ? "cli" : "pipe";

  // The live, in-memory config the harness reads via RunnerCtx — the edge
  // substrate (config, trace sink, wind-down / cancel signals) every harness gets.
  // Built BEFORE the context: a configured `gpu` must steer BOTH the resident
  // context and any provisioned reranker (env steer), so it applies first.
  // `model.id` + `model.sizeBytes` (stat'd here) + `surface` feed the measured
  // boot header the harness emits on `ready`.
  const cfg: Config = {
    ...loaded.config,
    surface,
    model: {
      ...loaded.config.model,
      path: modelPath,
      nCtx: context,
      // The display id mirrors the SAME selection resolution used: the
      // layered path when one won (a saved model must not display as the old
      // catalog id), else the yml catalog id.
      id: loaded.config.model.path ?? yml.model?.llm?.id ?? "model",
      sizeBytes: fileSize(modelPath),
    },
  };
  applyServedGpuEnv(cfg);

  const ctx = yield* call(() =>
    createContext(
      {
        modelPath,
        nCtx: context,
        nSeqMax: cfg.model.branches ?? 32,
        typeK: cfg.model.kvCache ?? "q4_0",
        typeV: cfg.model.kvCache ?? "q4_0",
      },
      cfg.model.gpu ? { gpuVariant: cfg.model.gpu } : undefined,
    ),
  );

  // Provision any auxiliary model an enabled ability needs (a reranker, etc.) BEFORE
  // the harness enables its abilities. No-op for the default (wikipedia needs none);
  // add a reranker-requiring ability to `abilities` and its model is fetched + verified
  // here, then injected via RerankerCtx.
  let fetchingReranker = false;
  try {
    yield* provisionAbilityModels({
      abilities,
      projectRoot: process.cwd(),
      // A saved reranker path outranks the yml entry.
      reranker: loaded.config.model.reranker
        ? { path: loaded.config.model.reranker }
        : yml.model?.reranker,
      // No-op for the default wikipedia ability; sizes the reranker the instant a
      // reranker-using ability (corpus/web) is added to `abilities`.
      rerankerLoad: { nSeqMax: 10, nCtx: 16384 },
      onProgress: (got, total) => {
        fetchingReranker = true;
        const pct = total > 0 ? Math.round((100 * got) / total) : 0;
        process.stderr.write(`\rfetching reranker — ${pct}%   `);
      },
    });
  } catch (err) {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  if (fetchingReranker) process.stderr.write("\n");

  // Dev observability is built HERE, not in the runner factory: the boot knows
  // its platform (Node), so it owns the fd and the env read, and the factory
  // just receives the sink. A boot over another binding (an RN shell over
  // nitro-llama) passes its own — see RunnerDevOpts.
  const dev = process.env.LLOYAL_DEV === "1";
  const trace = makeTraceWriter(cfg, dev);
  yield* ensure(trace.close);
  // Saves write harness.json, then re-layer for honest values + provenance
  // (a cleared key falls back to the rung beneath; env still outranks).
  const persist = (patch: ConfigPatch) => {
    const saved = saveLocalConfig(patch);
    const relayered = loadConfig(yml, {}, bootEnv);
    return { ...saved, config: relayered.config, origin: relayered.origin };
  };
  yield* RunnerCtx.set(
    makeEdgeRunner<Config, ConfigOrigin>(cfg, {
      traceWriter: trace.writer,
      dev,
      origin: loaded.origin,
      persist,
      sessionOriginMap: SESSION_ORIGIN_MAP,
    }),
  );

  const events = createBus<WorkflowEvent>();
  const commands = createSignal<Command, void>();
  const dispatch = (c: Command): void => {
    commands.send(c);
  };
  const bootstrap: WorkflowEvent[] = [];

  // Surface pick — the same events/commands, a different binding. Each binding
  // returns a disposer; tie it to the scope so listeners are torn down on exit.
  let dispose: () => void;
  if (surface === "desktop") {
    // A desktop shell forked this bin: stream over the process channel.
    dispose = ipc<WorkflowEvent, Command>()(events, dispatch, bootstrap);
  } else if (surface === "cli") {
    // A terminal: mount the Ink view.
    dispose = renderCli(events, dispatch, bootstrap);
  } else {
    // A pipe: newline-delimited JSON.
    dispose = ndjson<WorkflowEvent, Command>()(events, dispatch, bootstrap);
  }
  yield* ensure(() => dispose());

  // Run the harness. Returns when it sees `quit` (or the scope unwinds).
  yield* harness(ctx, events, commands);
});
