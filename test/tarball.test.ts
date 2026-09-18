/**
 * The templates are shipped as DATA: `files` is what keeps them in the
 * tarball, and a stray ignore rule or a `files` edit would publish a CLI that
 * scaffolds an incomplete project. CI used to pin the template file COUNT by
 * hand; the number went stale every time a template grew and nothing noticed
 * until the job ran, which on an arc branch it never did.
 *
 * The invariant is a relationship, not a number: what git tracks under
 * `templates/` is exactly what the tarball carries there. Both directions
 * matter. A missing file is an incomplete scaffold; an extra one is the other
 * trap — a `files` glob overrides `.gitignore`, so a checkout that has run the
 * templates' tests would pack their `node_modules` (24,000 files, measured).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

describe('the tarball ships the templates git tracks', () => {
  it('every tracked template file, and nothing else', { timeout: 30_000 }, () => {
    // npm never ships an .npmignore; it is the one tracked file meant to stay behind.
    const tracked = run('git', ['ls-files', 'templates']).trim().split('\n')
      .filter((p) => !p.endsWith('/.npmignore')).sort();
    // `--ignore-scripts`: prepack builds, and the build is not what is under test.
    const packed = (JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'])) as
      Array<{ files: Array<{ path: string }> }>)[0].files
      .map((f) => f.path).filter((p) => p.startsWith('templates/')).sort();

    expect(tracked.length).toBeGreaterThan(0);
    expect(packed).toEqual(tracked);
  });
});
