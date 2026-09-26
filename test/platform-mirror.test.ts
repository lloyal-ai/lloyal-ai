/**
 * The CLI mirrors three platform facts it cannot import — rig is not a dependency of the Apache CLI: the
 * service names (`SERVICES`), the catalog's ids and roles, and the presence rule over `harness.yml` and
 * `harness.json`. A mirror that drifts fails quietly (an install gate one service behind, a picker offering a
 * model the boot does not know). So each is held to the platform the templates actually install, read off the
 * template's own `node_modules` — the same packages a scaffolded project runs on.
 *
 * Skipped, and said so, where the template has no installed platform to read.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SERVICES, MODEL_CATALOG, DERIVED_SERVICES } from '../src/scaffold/model-catalog.js';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'basic');
const installed = existsSync(join(TEMPLATE, 'node_modules', '@lloyal-labs', 'rig', 'package.json'));
const platform = createRequire(join(TEMPLATE, 'package.json'));

describe.skipIf(!installed)('the CLI\'s mirrors of the platform', () => {
  it('DERIVED_SERVICES are exactly the provider rows with a derive cell', () => {
    const rig = platform('@lloyal-labs/rig/node') as { providers: Record<string, { derive?: unknown }> };
    const theirs = Object.entries(rig.providers).filter(([, row]) => typeof row.derive === 'function').map(([name]) => name).sort();
    expect([...DERIVED_SERVICES].sort()).toEqual(theirs);
  });

  it('SERVICES is the platform\'s closed set, in its order', () => {
    const rig = platform('@lloyal-labs/rig') as { SERVICES: readonly string[] };
    expect([...SERVICES]).toEqual([...rig.SERVICES]);
  });

  it('every catalog row the picker offers is a catalog row the boot fetches, at the same role', () => {
    const rig = platform('@lloyal-labs/rig/node') as { MODEL_CATALOG: readonly { id: string; role: string }[] };
    const theirs = new Map(rig.MODEL_CATALOG.map((m) => [m.id, m.role]));
    for (const m of MODEL_CATALOG) expect(theirs.get(m.id), `catalog row ${m.id}`).toBe(m.role);
  });

});

// ── the presence rule, held on both sides ────────────────────────────────────
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { modelSelection } from '../src/scaffold/model-selection.js';

type Loaded = { config: { model: Record<string, unknown> } };
type RigNode = { loadYml: (table: unknown, cwd: string) => unknown; loadConfig: (table: unknown, yml: unknown, source: { env: object; cwd: string }) => Loaded };
type RigRoot = { modelSettings: unknown };

/** What rig's loader says about a block, or the refusal it throws. */
function rigPresence(dir: string, role: string): boolean | 'refused' {
  const node = platform('@lloyal-labs/rig/node') as RigNode;
  const { modelSettings } = platform('@lloyal-labs/rig') as RigRoot;
  try {
    const { config } = node.loadConfig(modelSettings, node.loadYml(modelSettings, dir), { env: {}, cwd: dir });
    return role in config.model;
  } catch (err) {
    if (/must be a block|version 1/.test(String(err))) return 'refused';
    throw err;
  }
}
function cliPresence(dir: string, role: string): boolean | 'refused' {
  try { return modelSelection(dir, role as 'reranker' | 'vision').present; }
  catch (err) { if (/must be a block|version 1/.test(String(err))) return 'refused'; throw err; }
}

describe.skipIf(!installed)('the presence rule, held on both sides', () => {
  const cases: { name: string; role: string; yml: string; json?: object; want: boolean | 'refused' }[] = [
    { name: 'a mapping', role: 'reranker', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n  reranker:\n    id: qwen3-reranker-0.6b-q8\n', want: true },
    { name: 'an empty mapping', role: 'reranker', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n  reranker: {}\n', want: true },
    { name: 'a bare key', role: 'vision', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n  vision:\n', want: true },
    { name: 'an empty string', role: 'reranker', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n  reranker: ""\n', want: 'refused' },
    { name: 'a scalar', role: 'reranker', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n  reranker: x\n', want: 'refused' },
    { name: 'a commented-out block', role: 'reranker', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n  # reranker:\n  #   id: qwen3-reranker-0.6b-q8\n', want: false },
    { name: 'absent', role: 'embedding', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n', want: false },
    { name: 'json v2 null (a clear, as at a key)', role: 'vision', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n', json: { version: 2, sources: {}, abilities: {}, model: { vision: null } }, want: false },
    { name: 'json v2 null under a yml request (the overlay withdraws only its own word)', role: 'vision', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n  vision: {}\n', json: { version: 2, sources: {}, abilities: {}, model: { vision: null } }, want: true },
    { name: 'json v2 empty block', role: 'vision', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n', json: { version: 2, sources: {}, abilities: {}, model: { vision: {} } }, want: true },
    { name: 'json v2 null at a KEY under a yml selection (the overlay clears its own word; the committed id stands)', role: 'reranker', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n  reranker:\n    id: qwen3-reranker-0.6b-q8\n', json: { version: 2, sources: {}, abilities: {}, model: { reranker: { id: null } } }, want: true },
    { name: 'json v2 scalar', role: 'reranker', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n', json: { version: 2, sources: {}, abilities: {}, model: { reranker: 'x' } }, want: false },
    { name: 'json version 1 (before 1.11)', role: 'vision', yml: 'model:\n  llm:\n    id: qwen3.5-4b\n', json: { version: 1, sources: {}, abilities: {}, model: { mmproj: 'qwen3.5-4b-mmproj' } }, want: 'refused' },
  ];
  for (const c of cases) {
    it(`${c.name} → ${String(c.want)} on both`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'presence-'));
      try {
        writeFileSync(join(dir, 'harness.yml'), c.yml);
        if (c.json) writeFileSync(join(dir, 'harness.json'), JSON.stringify(c.json));
        expect(rigPresence(dir, c.role), 'rig').toBe(c.want);
        expect(cliPresence(dir, c.role), 'cli').toBe(c.want);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
