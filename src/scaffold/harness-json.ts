/**
 * The local overlay, `harness.json`, read for what it selects: the model family as rig would layer it
 * (`packages/rig/src/config-node.ts`). Read-only — the CLI never writes it; the settings pane does.
 *
 * Version 2 carries one block per model. Version 1 wrote the model keys flat under `model`, and is read at
 * the blocks its keys now live in, exactly as rig migrates it — a previously selected model must not vanish
 * from the CLI's view of the project any more than from the boot's. Absent, unreadable or a version this
 * CLI does not know: nothing, and the manifest alone answers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Where version 1 wrote each model key, flat under `model`, and the block it lives in now — rig's own map,
 *  held to it by `test/platform-mirror.test.ts`. */
export const V1_MODEL_KEYS: Record<string, [block: string, key: string]> = {
  id: ['llm', 'id'], path: ['llm', 'path'], nCtx: ['llm', 'context'], gpu: ['llm', 'gpu'], branches: ['llm', 'branches'], kvCache: ['llm', 'kvCache'],
  reranker: ['reranker', 'path'], rerankerId: ['reranker', 'id'],
  mmproj: ['vision', 'id'], imageMinTokens: ['vision', 'minTokens'], imageMaxTokens: ['vision', 'maxTokens'],
};

/** The overlay's model family — one block per model; `null` there is a clear, as at a key, and a scalar is
 *  dropped as any local value the key cannot take — or null when there is none to read. */
export function readLocalModel(projectDir: string): Record<string, Bag> | null {
  const p = join(projectDir, 'harness.json');
  if (!existsSync(p)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
  if (!isBag(parsed) || !isBag(parsed.model)) return null;
  const model = parsed.model;
  if (parsed.version === 2) return Object.fromEntries(Object.entries(model).filter((entry): entry is [string, Bag] => isBag(entry[1])));
  if (parsed.version !== 1) return null;
  const blocks: Record<string, Bag> = {};
  for (const [key, value] of Object.entries(model)) {
    const moved = V1_MODEL_KEYS[key];
    if (!moved) continue;
    const [block, at] = moved;
    blocks[block] = { ...(blocks[block] ?? {}), [at]: value };
  }
  return blocks;
}
