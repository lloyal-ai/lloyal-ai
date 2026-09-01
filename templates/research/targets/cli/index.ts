/**
 * The CLI target — where your research harness runs in a terminal.
 *
 * Generated for you and rarely touched. It does four things: resolve the
 * resident reasoning model, provision the Services the enabled abilities declare (the
 * corpus/web abilities need a reranker → `provisionAbilityModels` resolves + loads it and
 * publishes it on `RerankerCtx`), build this harness's edge `Runner`, pick a
 * surface, and run your harness over it. The surface pick is the whole "one
 * harness, many targets" idea in miniature — the same `harness(ctx, events,
 * commands)` mounts on Ink (a terminal), `ipc` (when a desktop shell forks this
 * bin), or `ndjson` (a pipe), all over one binding.
 *
 * Both models are files in `models/<role>/`, resolved from `harness.yml` and —
 * on first run — fetched + digest-verified by the platform (`rig.resolveModel`),
 * with no API key. Drop your own `.gguf` into `models/llm/` (or point a `path:`
 * at one) to skip the fetch entirely.
 *
 * SNAPSHOT: reasoning.run @ main
 */
import { join } from "node:path";
import { main, call, ensure } from "effection";
import { createBus } from "@lloyal-labs/binding";
import { ipc, ndjson } from "@lloyal-labs/binding/node";
import { startHostResources } from "@lloyal-labs/dev-tools/node";
import { createContext } from "@lloyal-labs/lloyal.node";
import { resolveModel, provisionAbilityModels, catalogEntry, useTraceWriter, createProjectMediaStore } from "@lloyal-labs/rig/node";
import { makeEdgeRunner } from "@lloyal-labs/rig";
import { harness, abilities } from "../../harness/harness.js";
import { RunnerCtx } from "../../harness/runner-ctx.js";
import { applyServedGpuEnv, bufferedCommandSignal } from "../../harness/served-runtime.js";
import type { Command, WorkflowEvent } from "../../harness/protocol.js";
import { loadConfig, loadYml, saveLocalConfig, SESSION_ORIGIN_MAP } from "../../harness/config.js";
import type { HarnessYml } from "../../harness/config.js";
import type { Config, ConfigOrigin, ConfigPatch, LoadedConfig } from "../../harness/config-types.js";
import { renderCli } from "./view.js";
// The layered config: cli > env > harness.json > harness.yml > default. A bad
// manifest or defaults value fails HERE — before any model fetch. `bootEnv` is
// snapshotted before `applyServedGpuEnv` writes LLOYAL_GPU, so re-layering
// after a save reads the user's env, never our own write.
// Where `harness.yml` was found — `loadYml` reads it from the cwd, so the two
// coincide today. Named separately because `media/` belongs to the PROJECT,
// not to wherever the operator happened to start the process; if `loadYml`
// ever searches upward, this is the one line that changes.
const projectRoot = process.cwd();

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
  // The reasoning model — a file in models/llm/, fetched + digest-verified on
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

  // The live config the harness reads via RunnerCtx — the layered result with
  // the model path RESOLVED. Built BEFORE the context: a configured `gpu` must
  // steer BOTH the resident context and the provisioned reranker (env steer),
  // so it applies first.
  const cfg: Config = {
    ...loaded.config,
    model: { ...loaded.config.model, path: modelPath, nCtx: context },
  };
  applyServedGpuEnv(cfg);

  // The vision projector. Optional and usually implicit: the catalog pairs an
  // mmproj with each vision-capable llm, so the user picks a model and gets
  // vision with it. A text-only model has no pairing and `mmprojPath` stays
  // undefined — `createContext` then reports `supportsVision() === false`
  // rather than failing, so a text-only boot is unaffected.
  let mmprojPath: string | undefined;
  {
    const mmprojId =
      loaded.config.model.mmproj ??
      (yml.model?.llm?.id ? catalogEntry("llm", yml.model.llm.id)?.mmproj : undefined);
    if (mmprojId) {
      mmprojPath = yield* call(() =>
        resolveModel({
          projectRoot: process.cwd(),
          role: "mmproj",
          spec: { id: mmprojId },
        }),
      );
    }
  }

  // The resident model context — one shared `llama_context`; the pipeline forks
  // recon / research / synth branches over it as seq_ids.
  const ctx = yield* call(() =>
    createContext(
      {
        modelPath,
        nCtx: context,
        nSeqMax: cfg.model.branches ?? 32,
        typeK: cfg.model.kvCache ?? "q4_0",
        typeV: cfg.model.kvCache ?? "q4_0",
        ...(mmprojPath ? { mmprojPath } : {}),
        ...(cfg.model.imageMinTokens ? { imageMinTokens: cfg.model.imageMinTokens } : {}),
        ...(cfg.model.imageMaxTokens ? { imageMaxTokens: cfg.model.imageMaxTokens } : {}),
      },
      cfg.model.gpu ? { gpuVariant: cfg.model.gpu } : undefined,
    ),
  );

  // Provision the Services the enabled abilities declare — corpus + web both declare
  // `services: ['reranker']`, so this resolves (fetch + digest-verify on first
  // run, no key) + loads the cross-encoder and publishes it on RerankerCtx, which
  // the harness's `registry.enable` reads. Reads the reranker spec from harness.yml
  // (`model.reranker`), else the platform catalog default.
  let fetchingReranker = false;
  try {
    yield* provisionAbilityModels({
      abilities,
      projectRoot: process.cwd(),
      // A saved reranker path outranks the yml entry.
      reranker: loaded.config.model.reranker
        ? { path: loaded.config.model.reranker }
        : yml.model?.reranker,
      // 10 leases (trunk + queryBranch + 8 scoring leaves); nCtx 16384 (rig
      // defaults 4096) sizes the reranker for longer rerank inputs.
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
  // Two sinks, two lifetimes. The trace is per-session and dev-gated; the
  // content store is durable, project-scoped and NEVER gated — addressability
  // is a replay requirement, not telemetry.
  // A resource: the descriptor closes when this scope exits, so there is no
  // `close()` for a caller to remember.
  const traceWriter = yield* useTraceWriter(cfg.sources.outputDir ?? process.cwd(), dev);
  const media = createProjectMediaStore(projectRoot);
  // Saves write harness.json, then re-layer for honest values + provenance
  // (a cleared key falls back to the rung beneath; env still outranks).
  const persist = (patch: ConfigPatch) => {
    const saved = saveLocalConfig(patch);
    const relayered = loadConfig(yml, {}, bootEnv);
    return { ...saved, config: relayered.config, origin: relayered.origin };
  };
  yield* RunnerCtx.set(
    makeEdgeRunner<Config, ConfigOrigin>(cfg, {
      traceWriter,
      attachmentStore: media,
      dev,
      origin: loaded.origin,
      persist,
      sessionOriginMap: SESSION_ORIGIN_MAP,
    }),
  );

  const events = createBus<WorkflowEvent>();
  // Buffered: the bindings dispatch from the moment they mount, but the
  // harness's command loop only arms after boot — a desktop renderer's (or a
  // pipe's) early command must wait, not vanish.
  const commands = bufferedCommandSignal<Command>();
  const dispatch = (c: Command): void => {
    commands.send(c);
  };
  const bootstrap: WorkflowEvent[] = [];

  // Surface pick — the same events/commands, a different binding. Each binding
  // returns a disposer; tie it to the scope so listeners are torn down on exit.
  let dispose: () => void;
  if (process.env.RR_BRIDGE) {
    // A desktop shell forked this bin: stream over the process channel.
    dispose = ipc<WorkflowEvent, Command>()(events, dispatch, bootstrap);
  } else if (process.stdout.isTTY) {
    // A terminal: mount the Ink view.
    dispose = renderCli(events, dispatch, bootstrap);
  } else {
    // A pipe: newline-delimited JSON.
    dispose = ndjson<WorkflowEvent, Command>()(events, dispatch, bootstrap);
  }
  yield* ensure(() => dispose());

  // Run the harness. Returns when it sees `quit` (or the scope unwinds).
  // Machine pressure beside model pressure — dev-gated, dies with this scope.
  if (dev) yield* ensure(startHostResources((ev) => events.send(ev)));
  yield* harness(ctx, events, commands);
});
