/**
 * Served (B-host) placement — the harness-RUNNING half. Isolated from the
 * compute glue in `./served-runtime` because it imports the `harness` (and thus its
 * `.eta` prompts): anything importing this file must be esbuilt with
 * `--loader:.eta=text`, never run as raw `tsx`. The web target's `serve.ts`
 * injects this as the host's `run`.
 *
 * SNAPSHOT: reasoning.run @ main (src/served-session.ts).
 */
import { closeSync, mkdirSync, openSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensure } from "effection";
import type { Operation, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import type { EventBus } from "@lloyal-labs/binding";
import { provisionAbilityModels } from "@lloyal-labs/rig/node";
import { startHostResources } from "@lloyal-labs/dev-tools/node";
import { NullTraceWriter, JsonlTraceWriter } from "@lloyal-labs/lloyal-agents";
import type { TraceWriter } from "@lloyal-labs/lloyal-agents";
import { makeServedRunner } from "@lloyal-labs/rig";
import { harness, abilities, RunnerCtx } from "./harness.js";
import { applyServedGpuEnv } from "./served-runtime.js";
import { SESSION_ORIGIN_MAP } from "./config.js";
import type { WorkflowEvent, Command } from "./protocol.js";
import type { Config, ConfigOrigin } from "./config-types.js";

/**
 * Run ONE served Session end to end: provision its per-session reranker + ability
 * services (its OWN reranker KV context over the shared resident weights, so
 * tenant documents never cross the reranker context), build the served `Runner`,
 * publish it on `RunnerCtx`, and run the UNCHANGED `harness(...)` over this
 * Session. `provisionAbilityModels` reads the corpus/web abilities' static
 * `services: ['reranker']`, loads the reranker, and publishes it on `RerankerCtx`
 * in THIS scope — the scope `harness()` runs in, so `registry.enable` injects it.
 * The host `spawn`s this as the per-session child; its scope owns BOTH the
 * reranker resource (disposes on teardown) and the `RunnerCtx` binding, so N
 * sessions share no runner state and no native reranker context.
 *
 * `cfg.model.reranker` is `serve.ts`'s resolved (digest-verified) reranker path →
 * a `{path}` spec rig uses as-is (no re-fetch). `applyServedGpuEnv(cfg)` runs
 * FIRST so the reranker load below (rig has no loadOptions passthrough) rides the
 * same `LLOYAL_GPU` as the resident context.
 *
 * The last three params ARE the `harness(ctx, events, commands)` signature — the
 * driver forwards the `{context, uiChannel, commands}` it materialised for the host.
 */
export function* runServedSession(
  cfg: Config,
  origin: ConfigOrigin,
  ctx: SessionContext,
  events: EventBus<WorkflowEvent>,
  commands: Signal<Command, void>,
): Operation<void> {
  applyServedGpuEnv(cfg);
  yield* provisionAbilityModels({
    abilities,
    projectRoot: process.cwd(),
    reranker: cfg.model.reranker ? { path: cfg.model.reranker } : undefined,
    // 10 leases (2 for trunk + queryBranch, 8 effective scoring leaves); nCtx
    // 16384 (rig defaults 4096) sizes the reranker for longer rerank inputs.
    rerankerLoad: { nSeqMax: 10, nCtx: 16384 },
  });
  // A served host is Node by definition, so the per-session sink is built
  // HERE (one trace file per admitted Session) and injected — the factory
  // stays binding-agnostic (see RunnerDevOpts).
  const dev = process.env.LLOYAL_DEV === "1";
  // Machine pressure beside model pressure: the pane overlays these samples
  // on the kv strip. Dev-gated like the trace sink; the timer dies with
  // this session's scope.
  if (dev) yield* ensure(startHostResources((ev) => events.send(ev)));
  const trace = makeTraceWriter(cfg, dev);
  // Per-session fd: closed when THIS session's scope unwinds (the writer
  // flushes every event synchronously, so nothing is pending at close) —
  // sequential sessions must not leak descriptors.
  yield* ensure(trace.close);
  yield* RunnerCtx.set(
    makeServedRunner<Config, ConfigOrigin>(cfg, {
      traceWriter: trace.writer,
      dev,
      origin,
      sessionOriginMap: SESSION_ORIGIN_MAP,
    }),
  );
  yield* harness(ctx, events, commands);
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
