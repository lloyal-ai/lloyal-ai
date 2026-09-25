/**
 * The view seam, held for every template: a view reaches the harness only through `HarnessProvider` and the
 * ui hooks. The provider is what puts the platform's own screens — the installer before the app opens — in
 * front of a view, so an entry that mounts the view without it has no installer, and a view that reads
 * `window.harness` or folds its own projection cannot be told anything the provider knows. Basic shipped
 * that way once; this holds both templates to the rule.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === 'out' || name === 'dist-web') return [];
    return statSync(p).isDirectory() ? walk(p) : p;
  });

describe.each(['basic', 'research'])('the view seam in %s', (template) => {
  const root = join(TEMPLATES, template);
  // By basename, not by a `/` in the path: the seam holds on every platform's separator.
  const entries = walk(join(root, 'targets')).filter((f) => basename(f) === 'view.tsx' || basename(f) === 'main.tsx');

  it('every renderer entry mounts HarnessProvider', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(readFileSync(entry, 'utf8'), entry).toContain('HarnessProvider');
  });

  it('the view reads the harness through the hooks, never the bridge or a fold of its own', () => {
    for (const file of walk(join(root, 'src', 'ui')).filter((f) => /\.tsx?$/.test(f))) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/window\.harness/);
      expect(source, file).not.toMatch(/connectProjection\(/);
    }
  });
});
