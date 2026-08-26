/**
 * The harness's served COMPUTE glue — the harness-free half a web driver
 * imports without pulling esbuild (no `.eta` prompts transit this file). The
 * `Runner` factories live in `@lloyal-labs/rig` (`makeEdgeRunner` /
 * `makeServedRunner`); what stays here is what genuinely differs per harness:
 * how a Session's compute context is built (nCtx / nSeqMax / kvCache
 * defaults) and how a configured GPU steers the native backend.
 *
 * A served host materialises one `SessionContext` per admitted Session over
 * one resident model; lloyal.node's ModelRegistry weak-caches the model by
 * path, so the Nth session shares the resident weights + only allocates a
 * fresh KV context. The reranker is NOT built here —
 * `provisionAbilityModels` (in `runServedSession` / the cli boot) loads it
 * and publishes it on `RerankerCtx`, so no export here touches it.
 */
import { createSignal } from "effection";
import type { Signal } from "effection";
import { createContext as createNativeContext } from "@lloyal-labs/lloyal.node";
import type { SessionContext } from "@lloyal-labs/sdk";
import { createBus, type EventBus } from "@lloyal-labs/binding";
import type { WorkflowEvent, Command } from "./protocol.js";
import type { Config } from "./config-types.js";

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
