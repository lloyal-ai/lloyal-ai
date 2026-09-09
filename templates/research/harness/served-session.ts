/**
 * Served (B-host) placement — the harness-RUNNING half. Isolated from the
 * compute glue in `./served-runtime` because it imports the `harness` (and thus its
 * `.eta` prompts): anything importing this file must be esbuilt with
 * `--loader:.eta=text`, never run as raw `tsx`. The web target's `serve.ts`
 * injects this as the host's `run`.
 *
 * LINEAGE: evolved from reasoning.run's src/served-session.ts.
 */
import { ensure } from "effection";
import type { Operation, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import type { EventBus } from "@lloyal-labs/binding";
import { provisionAbilityModels, useTraceWriter } from "@lloyal-labs/rig/node";
import type { AttachmentStore, ContentIngress } from "@lloyal-labs/media";
import { Ingress } from "@lloyal-labs/lloyal-agents";
import { startHostResources } from "@lloyal-labs/dev-tools/node";
import { makeServedRunner } from "@lloyal-labs/rig";
import { harness, abilities } from "./harness.js";
import { RunnerCtx } from "./runner-ctx.js";
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
  /** The host's ONE project content store, shared by every Session. Injected
   *  rather than built here: a per-Session instance over the same directory
   *  would be N objects racing one index for no reason. */
  media: AttachmentStore,
  /** The host's ONE ingress service — shared for the same reason the store is,
   *  and so every entry point admits media identically. */
  ingress: ContentIngress,
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
  // Trace only: per-session and dev-gated. The content store is created ONCE
  // by the host (`serve.ts`) and injected — one object shared by every Session,
  // not one per Session pointing at the same directory.
  const traceWriter = yield* useTraceWriter(cfg.sources.outputDir ?? process.cwd(), dev, (ev) => events.send(ev));
  yield* RunnerCtx.set(
    makeServedRunner<Config, ConfigOrigin>(cfg, {
      traceWriter,
      attachmentStore: media,
      dev,
      origin,
      sessionOriginMap: SESSION_ORIGIN_MAP,
    }),
  );
  yield* Ingress.set(ingress);
  yield* harness(ctx, events, commands);
}
