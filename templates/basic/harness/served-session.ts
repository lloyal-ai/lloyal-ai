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
import { openSync } from "node:fs";
import { join } from "node:path";
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
import type { Config } from "./config-types.js";

export function* runServedSession(
  cfg: Config,
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
  yield* RunnerCtx.set(makeServedRunner(cfg, { traceWriter: makeTraceWriter(cfg, dev), dev }));
  yield* harness(ctx, events, commands);
}

/** The dev-gated trace sink: under `LLOYAL_DEV=1`, a `trace-<ts>.jsonl` in
 *  `sources.outputDir` (default: the project root) — the record the dev tools
 *  tail. Otherwise Null: production writes nothing. A failed open degrades to
 *  Null (tracing is observability, never a dependency); the fd lives for the
 *  process — the `TraceWriter` contract has no dispose. */
function makeTraceWriter(cfg: Config, dev: boolean): TraceWriter {
  if (!dev) return new NullTraceWriter();
  try {
    const dir = cfg.sources.outputDir ?? process.cwd();
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    return new JsonlTraceWriter(openSync(join(dir, `trace-${ts}.jsonl`), "w"));
  } catch {
    return new NullTraceWriter();
  }
}
