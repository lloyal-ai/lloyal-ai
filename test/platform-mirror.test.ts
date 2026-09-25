/**
 * The CLI mirrors three platform facts it cannot import — rig is not a dependency of the Apache CLI: the
 * service names (`SERVICES`), the catalog's ids and roles, and where a version-1 `harness.json` kept each
 * model key. A mirror that drifts fails quietly (an install gate one service behind, a picker offering a model
 * the boot does not know). So each is held to the platform the templates actually install, read off the
 * template's own `node_modules` — the same packages a scaffolded project runs on.
 *
 * Skipped, and said so, where the template has no installed platform to read.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SERVICES, MODEL_CATALOG } from '../src/scaffold/model-catalog.js';
import { V1_MODEL_KEYS } from '../src/scaffold/harness-json.js';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'basic');
const installed = existsSync(join(TEMPLATE, 'node_modules', '@lloyal-labs', 'rig', 'package.json'));
const platform = createRequire(join(TEMPLATE, 'package.json'));

describe.skipIf(!installed)('the CLI\'s mirrors of the platform', () => {
  it('SERVICES is the platform\'s closed set, in its order', () => {
    const rig = platform('@lloyal-labs/rig') as { SERVICES: readonly string[] };
    expect([...SERVICES]).toEqual([...rig.SERVICES]);
  });

  it('every catalog row the picker offers is a catalog row the boot fetches, at the same role', () => {
    const rig = platform('@lloyal-labs/rig/node') as { MODEL_CATALOG: readonly { id: string; role: string }[] };
    const theirs = new Map(rig.MODEL_CATALOG.map((m) => [m.id, m.role]));
    for (const m of MODEL_CATALOG) expect(theirs.get(m.id), `catalog row ${m.id}`).toBe(m.role);
  });

  it('a version-1 harness.json is read at the same blocks the boot reads it at', () => {
    const rig = platform('@lloyal-labs/rig/node') as { V1_MODEL_KEYS: Record<string, [string, string]> };
    expect(V1_MODEL_KEYS).toEqual(rig.V1_MODEL_KEYS);
  });
});
