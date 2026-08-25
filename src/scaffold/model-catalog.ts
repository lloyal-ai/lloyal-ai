/**
 * A minimal, vendored copy of `@lloyal-labs/rig`'s model catalog — just the
 * fields the interactive `new` model picker needs (`id` / `role` / `label` /
 * `recommendedContext`), NOT the download URLs or digests (rig owns fetching +
 * verification; the CLI only offers the choice).
 *
 * It is vendored, not imported, on purpose: the catalog is only exported from
 * `@lloyal-labs/rig/node`, whose barrel also pulls in `createReranker` (the
 * NATIVE `@lloyal-labs/lloyal.node`) + the Ability registry. `lloyal` is the
 * Apache-2.0, zero-native-dep CLI — `verify.ts` duplicates rig's verify surface
 * for exactly this reason. Keep these rows in sync with rig's `MODEL_CATALOG`
 * (packages/rig/src/models.ts); adding a row here only widens the picker.
 */

export type ModelRole = 'llm' | 'reranker';

export interface CatalogModel {
  /** Stable id — what gets written into `harness.yml` `model.<role>.id`. */
  id: string;
  role: ModelRole;
  /** Human label for the picker row. */
  label: string;
  /** Suggested `context` (nCtx) — written alongside an `llm` choice. */
  recommendedContext?: number;
}

/** Mirrors `@lloyal-labs/rig`'s `MODEL_CATALOG`, minus urls/sha256/sizeBytes. */
export const MODEL_CATALOG: readonly CatalogModel[] = [
  {
    id: 'qwen3.5-4b',
    role: 'llm',
    label: 'Qwen3.5 4B · Q4_K_M · 2.6 GB',
    recommendedContext: 32768,
  },
  {
    id: 'qwen3.8-27b-q4',
    role: 'llm',
    label: 'Qwen3.8 27B · Q4_K_M · 16.5 GB',
    recommendedContext: 32768,
  },
  {
    id: 'qwen3.8-27b-iq1',
    role: 'llm',
    label: 'Qwen3.8 27B · UD-IQ1_S · 6.2 GB',
    recommendedContext: 32768,
  },
  {
    id: 'qwen3-reranker-0.6b-q8',
    role: 'reranker',
    label: 'Qwen3 Reranker 0.6B · Q8_0',
  },
];

/**
 * One short line under the model picker. Size is on each row; the Field above
 * already covers fetch + verification, so this says the one thing neither does.
 *
 * Keep it to a single clause a reader can take in without stopping. Anything
 * needing a "because" belongs in the docs, not at the moment of choosing.
 *
 * The 16 GB figure is measured, not guessed: the machine the `research`
 * template was verified end-to-end on (Apple M2, 16 GB) running `qwen3.5-4b`
 * plus the 0.6B reranker. No figure is offered for the 27B rows because none
 * has been measured — better silent than invented.
 */
export const MODEL_FOOTPRINT_HINT = '16 GB RAM runs the 4B. Larger models need more.';

/** The catalog entries for one role, in listing order. */
export function modelsForRole(role: ModelRole): readonly CatalogModel[] {
  return MODEL_CATALOG.filter((m) => m.role === role);
}
