/**
 * The harness config *schema* — the node-free type block.
 *
 * Carved from reasoning.run's `src/tui-ink/config.ts` (the `Config` family +
 * `ConfigOrigin`). NO runtime code — a browser/renderer surface and the
 * `reduce` graph import these types, so the file stays erasable
 * (`import type` only). The base plumbing types (`ConfigOriginValue`,
 * `ConfigPatch`, `SaveResult`, `LoadedConfig`) come from `@lloyal-labs/rig`;
 * this file specializes them to THIS harness's shapes.
 */
import type {
  ConfigOriginValue,
  ConfigPatch as RigConfigPatch,
  LoadedConfig as RigLoadedConfig,
} from "@lloyal-labs/rig";

export type { ConfigOriginValue, SaveResult } from "@lloyal-labs/rig";

export interface ConfigSources {
  /** Where per-query run-dirs (report.md + annexure-N.md) and the session
   *  trace.jsonl get written. Default = process.cwd() at boot. This is
   *  harness config — NOT a per-ability config object. */
  outputDir?: string;
}

/** Per-ability stored config, keyed by `manifest.name` → the ability's config object
 *  (whatever the ability's `configSchema` declares; e.g. `{ corpusPath }`,
 *  `{ tavilyKey }`). The harness never reads inside these objects — it
 *  whole-replaces an ability's entry and hands it to the registry, which
 *  validates against the ability's `configSchema` on enable. Secrets (e.g.
 *  `tavilyKey`) live here verbatim; env-provided secrets win at the ability
 *  factory and are never written back. */
export type ConfigApps = Record<string, Record<string, unknown>>;

export interface ConfigDefaults {
  reasoningMode: 'flat' | 'deep';
  /** Run effort preset — the session default for the composer's effort control
   *  (pure policy: budget + planner breadth + recovery cap). @default 'high' */
  effort: 'low' | 'medium' | 'high' | 'ultra';
  maxTurns: number;
}

/** GPU backend variant — mirrors lloyal.node's `GpuVariant` union (config
 *  deliberately takes no lloyal.node dependency). 'default' is the portable
 *  CPU-capable build (works everywhere); 'cuda' / 'vulkan' request an accelerated
 *  build. An explicitly configured variant is a deliberate deploy choice — the
 *  served boot fails fast on an unavailable one (`LLOYAL_NO_FALLBACK`, see
 *  `applyServedGpuEnv`) rather than silently dropping to CPU. */
export type ConfigGpu = 'default' | 'cuda' | 'vulkan';

/** KV cache type for the attention layers. Mirrors the SDK's `KvCacheType`;
 *  restated here so this file stays dependency-free like `ConfigGpu`. */
export type ConfigKvCache =
  | 'f32' | 'f16' | 'bf16' | 'q8_0' | 'q4_0' | 'q4_1' | 'iq4_nl' | 'q5_0' | 'q5_1';

export const CONFIG_GPU_VALUES: readonly ConfigGpu[] = [
  'default',
  'cuda',
  'vulkan',
];

export function isConfigGpu(v: unknown): v is ConfigGpu {
  return typeof v === 'string' && (CONFIG_GPU_VALUES as readonly string[]).includes(v);
}

export interface ConfigModel {
  /** Filesystem path OR catalog id (e.g. `qwen3.5-4b-q4`). Resolution is
   *  the caller's concern — config just stores whatever the user typed. */
  path?: string;
  reranker?: string;
  /** LLM context window size. Null/undefined falls through to CLI/env/default. */
  nCtx?: number;
  /** GPU backend variant. Null/undefined falls through to CLI/env/default
   *  (env source: LLOYAL_GPU). */
  gpu?: ConfigGpu;
  /** BACKEND_DL pack consent. `false` = user declined the boot-time offer
   *  ("won't ask again"); undefined = never asked / may offer. Never `true`:
   *  acceptance is evidenced by the cache itself, not a config bit. */
  backendPack?: boolean;
  /** Concurrent sequences (`nSeqMax`). Each holds its own KV lease, and on a
   *  hybrid/linear-attention model its own recurrent state — which is f32 and
   *  unaffected by `kvCache`, so this is the lever on a memory-bound machine. */
  branches?: number;
  /** KV cache type for the attention layers. Bounds the smallest meaningful
   *  score difference; raise for precision, lower for memory. */
  kvCache?: ConfigKvCache;
}

export interface Config {
  version: 1;
  sources: ConfigSources;
  /** Per-ability stored config, keyed by `manifest.name`. The harness seeds
   *  `configStore` from this on boot (loop over entries) and whole-replaces
   *  an ability's entry on `set_ability_config`. Persisted under `abilities[name]`. */
  abilities: ConfigApps;
  defaults: ConfigDefaults;
  model: ConfigModel;
}

/** Which layer supplied a given harness-level field — used for composer UI
 *  hints. Per-ability config lives in `Config.abilities` and carries no origin
 *  tracking (abilities validate their own config at enable time). A type
 *  alias (not an interface) so it satisfies the factories'
 *  `Record<string, ConfigOriginValue>` bound structurally. */
export type ConfigOrigin = {
  reasoningMode: ConfigOriginValue;
  modelPath: ConfigOriginValue;
  reranker: ConfigOriginValue;
  nCtx: ConfigOriginValue;
  gpu: ConfigOriginValue;
  outputDir: ConfigOriginValue;
};

/** This harness's config write — rig's one-level-deep patch over `Config`:
 *  `defaults` is PARTIAL, so a save carries only the keys it changes and
 *  harness.json never pins untouched defaults over a later harness.yml edit. */
export type ConfigPatch = RigConfigPatch<Config>;

/** The layered load result, specialized to this harness's shapes. */
export type LoadedConfig = RigLoadedConfig<Config, ConfigOrigin>;

export interface CliOverrides {
  reasoningMode?: 'flat' | 'deep';
  modelPath?: string;
  reranker?: string;
  nCtx?: number;
  gpu?: ConfigGpu;
  outputDir?: string;
}
