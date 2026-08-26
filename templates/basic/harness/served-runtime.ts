/**
 * Your harness's served COMPUTE glue — the harness-free half the web driver
 * imports. The `Runner` factories live in `@lloyal-labs/rig`
 * (`makeEdgeRunner` / `makeServedRunner`); what stays here is what genuinely
 * differs per harness: how a Session's compute context is built (nCtx /
 * nSeqMax / kvCache defaults) and how a configured GPU steers the native
 * backend.
 *
 * Structurally mirrors the reference `research` template + reasoning.run: a
 * served host materialises one `SessionContext` per admitted Session over one
 * resident model; lloyal.node's ModelRegistry weak-caches the model by path,
 * so N Sessions share the resident weights + each pays only its own KV. The
 * reranker is NOT built here — `provisionAbilityModels` (in the boot /
 * `runServedSession`) loads it and publishes it on `RerankerCtx`.
 */
import { createSignal } from "effection";
import type { Signal } from "effection";
import { createContext } from "@lloyal-labs/lloyal.node";
import type { SessionContext } from "@lloyal-labs/sdk";
import { createBus, type EventBus } from "@lloyal-labs/binding";
import type { WorkflowEvent, Command } from "./protocol.js";
import type { Config } from "./config-types.js";

/**
 * Steer the native backend for the resident model context via
 * `process.env.LLOYAL_GPU`. A configured backend is an EXPLICIT deploy request →
 * fail loud on an unavailable variant (`LLOYAL_NO_FALLBACK`, never overriding a
 * user-set one) instead of silently loading on CPU. With no gpu configured, any
 * inherited `LLOYAL_GPU` is CLEARED — config stays the source of truth.
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

/** Build one Session's compute context over the resident model. Every Session's
 *  context is created over the SAME `cfg.model.path` → `lloyal.node`'s
 *  ModelRegistry weak-caches the weights, so N Sessions share one resident model,
 *  each paying only its own KV. */
export function createServedContext(cfg: Config): Promise<SessionContext> {
  const modelPath = cfg.model.path;
  if (!modelPath) {
    throw new Error(
      "createServedContext: cfg.model.path is required (the host's resident model)",
    );
  }
  applyServedGpuEnv(cfg);
  return createContext(
    {
      modelPath,
      nCtx: cfg.model.nCtx ?? 32768,
      nSeqMax: cfg.model.branches ?? 32,
      typeK: cfg.model.kvCache ?? "q4_0",
      typeV: cfg.model.kvCache ?? "q4_0",
    },
    cfg.model.gpu ? { gpuVariant: cfg.model.gpu } : undefined,
  );
}

/** The per-connection event bus + command signal. The socket binds to these at
 *  connect time (via binding's `wss()`); the harness sends/receives through them. */
export function createServedChannels(): {
  uiChannel: EventBus<WorkflowEvent>;
  commands: Signal<Command, void>;
} {
  return { uiChannel: createBus<WorkflowEvent>(), commands: createSignal<Command, void>() };
}
