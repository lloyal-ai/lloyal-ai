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

/** The size of machine a model is for. Mirrors rig's `MachineClass`. */
export type MachineClass = 'edge' | 'appliance';

export interface CatalogModel {
  /** Stable id — what gets written into `harness.yml` `model.<role>.id`. */
  id: string;
  role: ModelRole;
  /** Human label for the picker row. */
  label: string;
  /** Suggested `context` (nCtx) — written alongside an `llm` choice. */
  recommendedContext?: number;
  /** LLM rows only: the smallest machine this runs on. The CLI does not
   *  enforce it — it cannot know which machine the project will be RUN on,
   *  only which one is scaffolding — so this is here to be shown, and the boot
   *  is what refuses a box that cannot hold the weights. */
  machineClass?: MachineClass;
}

/** Mirrors `@lloyal-labs/rig`'s `MODEL_CATALOG`, minus urls/sha256/sizeBytes. */
export const MODEL_CATALOG: readonly CatalogModel[] = [
  {
    id: 'qwen3.5-4b',
    role: 'llm',
    label: 'Qwen3.5 4B · Q4_K_M · 2.6 GB',
    recommendedContext: 32768,
    machineClass: 'edge',
  },
  {
    id: 'qwen3.8-27b-q4',
    role: 'llm',
    label: 'Qwen3.8 27B · Q4_K_M · 16.5 GB',
    recommendedContext: 32768,
    machineClass: 'appliance',
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
 * These are the FLOORS the boot enforces (rig's `MACHINE_CLASS_FLOOR_BYTES`),
 * not comfortable sizes: under them a run is refused before it downloads
 * anything, so they are the numbers a reader needs at the moment of choosing.
 * For reference, the `research` template was verified end-to-end on an Apple M2
 * with 16 GB — a roomy edge box, well over the 10 GB floor.
 */
export const MODEL_FOOTPRINT_HINT = 'The 4B needs 10 GB RAM; the 27B needs 24 GB.';

/** The catalog entries for one role, in listing order. */
export function modelsForRole(role: ModelRole): readonly CatalogModel[] {
  return MODEL_CATALOG.filter((m) => m.role === role);
}
