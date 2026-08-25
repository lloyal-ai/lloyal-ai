/**
 * The harness config *schema* — the node-free type block.
 *
 * The `Runner` ({@link ./runner-ctx}) hands the harness its live config; this is
 * that config's shape. NO `node:fs`/`node:path` — a browser/renderer surface and
 * the served-runner factory both import these types, so the file must stay
 * runtime-free. `basic`'s runner (`makeEdgeRunner`) holds config in memory, so
 * there are no on-disk loaders to carve out — this is the whole config surface.
 *
 * It's deliberately lean: `abilities` (per-ability config the harness seeds the config
 * store from) + `model` (where the resident model lives). Grow it as your harness
 * grows — the reference `research` template's version adds run `defaults`
 * (reasoning mode / effort) the same way.
 */

export interface ConfigSources {
  /** Where a harness that writes run artifacts (reports, traces) puts them.
   *  `basic` writes none; the field is here so the `saveConfig` seam is complete
   *  for a harness that grows one. Default = process.cwd() at boot. */
  outputDir?: string;
}

/** Per-ability stored config, keyed by `manifest.name` → the ability's config object
 *  (whatever the ability's `configSchema` declares; e.g. `{ corpusPath }`,
 *  `{ tavilyKey }`). The harness never reads inside these objects — it
 *  whole-replaces an ability's entry and hands it to the registry, which validates
 *  against the ability's `configSchema` on enable. The default wikipedia ability needs
 *  none, so this stays empty. */
export type ConfigApps = Record<string, Record<string, unknown>>;

/** GPU backend variant — mirrors lloyal.node's `GpuVariant` union (config
 *  deliberately takes no lloyal.node dependency). 'default' is the portable
 *  CPU-capable build (works everywhere); 'cuda' / 'vulkan' request an accelerated
 *  build. An explicitly configured variant is a deliberate deploy choice — the
 *  served boot fails fast on an unavailable one (`LLOYAL_NO_FALLBACK`, see
 *  `applyServedGpuEnv`) rather than silently dropping to CPU. */
export type ConfigGpu = 'default' | 'cuda' | 'vulkan';

export const CONFIG_GPU_VALUES: readonly ConfigGpu[] = [
  'default',
  'cuda',
  'vulkan',
];

export function isConfigGpu(v: unknown): v is ConfigGpu {
  return typeof v === 'string' && (CONFIG_GPU_VALUES as readonly string[]).includes(v);
}

/** KV cache type for the attention layers. Mirrors the SDK's `KvCacheType`;
 *  restated here so this file stays dependency-free like `ConfigGpu`. */
export type ConfigKvCache =
  | 'f32' | 'f16' | 'bf16' | 'q8_0' | 'q4_0' | 'q4_1' | 'iq4_nl' | 'q5_0' | 'q5_1';

export interface ConfigModel {
  /** Filesystem path OR catalog id (e.g. `qwen3.5-4b`). Resolution is the
   *  caller's concern (`rig.resolveModel`) — config just stores whatever the
   *  boot resolved. */
  path?: string;
  /** The reranker model path/id, when an enabled ability declares the `reranker`
   *  service. Empty for the default wikipedia ability (needs none). */
  reranker?: string;
  /** LLM context window size. Null/undefined falls through to the default. */
  nCtx?: number;
  /** GPU backend variant. Null/undefined = the platform default backend. */
  gpu?: ConfigGpu;
  /** The model's display id + its measured on-disk size — the boot stats the
   *  resolved weight and stores these so the harness can render a *measured*
   *  boot header (see `BootFacts`), never a hardcoded string. */
  id?: string;
  sizeBytes?: number;
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
   *  an ability's entry on `set_app_config`. */
  abilities: ConfigApps;
  model: ConfigModel;
  /** Which surface this process mounted (`cli` · `desktop` · `pipe` · `web`) —
   *  a boot-time runtime fact the harness echoes into the boot header. */
  surface?: string;
}

/** Which layer supplied a given harness-level field — used for composer UI
 *  hints. `basic`'s in-memory runner reports everything as `default`. */
export interface ConfigOrigin {
  modelPath: 'cli' | 'file' | 'default';
  reranker: 'cli' | 'file' | 'default';
  nCtx: 'cli' | 'env' | 'file' | 'default';
  gpu: 'cli' | 'env' | 'file' | 'default';
  outputDir: 'cli' | 'file' | 'default';
}

export interface SaveResult {
  path: string;
  /** true iff this save appended a config file to `.gitignore` during this call.
   *  Always false for `basic`'s in-memory runner. */
  gitignored: boolean;
  /** Fields that were IN the patch but deliberately skipped (env won). */
  skipped: string[];
}
