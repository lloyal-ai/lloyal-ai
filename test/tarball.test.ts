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
import { writeFileSync, rmSync } from 'node:fs';
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

  /** The relationship above only fails when the file is actually THERE — and a credentials file is
   *  there exactly when somebody has been testing `--notarize` inside `templates/`, which is the
   *  case nobody runs the suite in. So put one there on purpose. Three independent mechanisms have
   *  to hold: `.gitignore` for the branch, `files` for the tarball (it overrides `.gitignore`, so
   *  saying it once is not saying it twice), and the copier for the next developer's project. */
  it("leaves a machine's credentials behind, even sitting inside a template", { timeout: 30_000 }, () => {
    const local = join(root, 'templates/research/targets/desktop/.env.local');
    const overlay = join(root, 'templates/research/harness.json');
    writeFileSync(local, 'CSC_KEY_PASSWORD=SYNTHETIC-CREDENTIAL\n');
    writeFileSync(overlay, '{"note":"SYNTHETIC-CREDENTIAL"}\n');
    try {
      const packed = (JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'])) as
        Array<{ files: Array<{ path: string }> }>)[0].files.map((f) => f.path);

      expect(packed.some((p) => p.endsWith('.env.local'))).toBe(false);
      expect(packed.some((p) => p.endsWith('harness.json'))).toBe(false);
      // The committed file that documents where credentials go still ships.
      expect(packed).toContain('templates/research/targets/web/.env');
      // And git would not have taken them either. `check-ignore` exits non-zero when it would.
      expect(() => run('git', ['check-ignore', '-q', local])).not.toThrow();
      expect(() => run('git', ['check-ignore', '-q', overlay])).not.toThrow();
    } finally {
      rmSync(local, { force: true });
      rmSync(overlay, { force: true });
    }
  });
});
