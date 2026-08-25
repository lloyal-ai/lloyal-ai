/**
 * Served (B-host) placement — the harness-RUNNING half the driver INJECTS.
 * Isolated from the factories in `./served-runtime` because it imports the
 * `harness`: the web target's `serve.ts` hands it to the driver as `run`, and the
 * host calls it once per admitted Session as a structured child.
 *
 * Structurally identical to the reference `research` template + reasoning.run: a
 * Session provisions the enabled abilities' Services into ITS OWN scope (a no-op for
 * the default wikipedia ability, which needs none), builds the served `Runner`,
 * publishes it on `RunnerCtx`, and runs the UNCHANGED `harness(...)`. The provision
 * is per-session (not host-boot) so no tenant's context is shared — the same
 * isolation reasoning.run's per-session reranker gives. `cfg.model.reranker` is a
 * resolved `{path}` when a reranker-using ability is enabled; absent, `provisionAbilityModels`
 * falls back to the platform catalog default (and is a no-op if no ability needs one).
 */
import { closeSync, mkdirSync, openSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensure } from "effection";
import type { Operation, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import type { EventBus } from "@lloyal-labs/binding";
import { provisionAbilityModels } from "@lloyal-labs/rig/node";
import { NullTraceWriter, JsonlTraceWriter } from "@lloyal-labs/lloyal-agents";
import type { TraceWriter } from "@lloyal-labs/lloyal-agents";
import { harness, abilities } from "./harness.js";
import { RunnerCtx } from "./runner-ctx.js";
import { applyServedGpuEnv, makeServedRunner } from "./served-runtime.js";
import type { WorkflowEvent, Command } from "./protocol.js";
import type { Config, ConfigOrigin } from "./config-types.js";

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
    // Sized for longer rerank inputs (rig defaults nCtx 4096). No-op for the
    // default wikipedia ability; used the instant a reranker-using ability is enabled.
    rerankerLoad: { nSeqMax: 10, nCtx: 16384 },
  });
  // A served host is Node by definition, so the per-session sink is built
  // HERE (one trace file per admitted Session) and injected — the factory
  // stays binding-agnostic (see RunnerDevOpts).
  const dev = process.env.LLOYAL_DEV === "1";
  const trace = makeTraceWriter(cfg, dev);
  // Per-session fd: closed when THIS session's scope unwinds (the writer
  // flushes every event synchronously, so nothing is pending at close) —
  // sequential sessions must not leak descriptors.
  yield* ensure(trace.close);
  yield* RunnerCtx.set(makeServedRunner(cfg, { traceWriter: trace.writer, dev, origin }));
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
