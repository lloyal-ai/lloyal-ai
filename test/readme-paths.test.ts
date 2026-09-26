/**
 * The README is the front door, and a front door that names a file which is not there is worse than none:
 * its "three edits" tree described `src/research/` for weeks after the template had moved to `src/harness/`.
 * Every project path it names in backticks must exist in the template it describes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('the README names files that exist', () => {
  it('every `src/…` and `targets/…` path is in the research template, which the README walks', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const named = [...readme.matchAll(/`((?:src|targets|test)\/[^`\s*<]*)`/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(3);
    const missing = [...new Set(named)].filter((p) => !existsSync(join(ROOT, 'templates/research', p)));
    expect(missing, 'named in the README, not in templates/research').toEqual([]);
  });
});
