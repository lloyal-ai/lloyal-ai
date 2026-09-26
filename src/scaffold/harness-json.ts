/**
 * The local overlay, `harness.json`, read for what it selects: the model family as rig would layer it
 * (`packages/rig/src/config-node.ts`). Read-only — the CLI never writes it; the settings pane does.
 *
 * Version 2 carries one block per model; `null` at a block is a clear, as at a key, and a scalar is dropped as
 * any local value the key cannot take. A version-1 file — written before 1.11 — is refused by name, as rig
 * refuses it. Absent, unreadable or a version this CLI does not know: nothing, and the manifest alone answers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The overlay's model family — one block per model — or null when there is none to read. */
export function readLocalModel(projectDir: string): Record<string, Bag> | null {
  const p = join(projectDir, 'harness.json');
  if (!existsSync(p)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
  if (!isBag(parsed)) return null;
  if (parsed.version === 1) throw new Error('harness.json is version 1, written before 1.11 — delete it and relaunch.');
  if (parsed.version !== 2 || !isBag(parsed.model)) return null;
  return Object.fromEntries(Object.entries(parsed.model).filter((entry): entry is [string, Bag] => isBag(entry[1])));
}
