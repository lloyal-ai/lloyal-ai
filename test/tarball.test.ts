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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  /**
   * The relationship above only fails when the file is actually THERE — and a credentials file is
   * there exactly when somebody has been testing `--notarize` inside `templates/`, which is the
   * case nobody runs the suite in. So it has to be put there on purpose.
   *
   * NOT in this checkout, though. `harness.json` is the local overlay and `.env.local` holds a
   * signing certificate: writing them at their real paths and removing them afterwards destroys a
   * developer's own files, which is precisely what an earlier version of this row did. Neither
   * mechanism needs them to exist here — `git check-ignore` answers for a path that does not
   * exist, and the `files` rules are exercised against a throwaway package built from the REAL
   * `files` array, so a change to it still fails this row.
   */
  it("leaves a machine's credentials behind, even sitting inside a template", { timeout: 30_000 }, () => {
    const local = 'templates/research/targets/desktop/.env.local';
    const overlay = 'templates/research/harness.json';
    // `*.local` is the whole class the repository ignores; `files` has to mirror it, because it
    // overrides `.gitignore` and would otherwise publish anything else ending that way.
    const other = 'templates/research/credentials.local';

    // The repository boundary. `check-ignore` exits non-zero when a path would NOT be ignored.
    for (const path of [local, overlay, other]) {
      expect(() => run('git', ['check-ignore', '-q', path])).not.toThrow();
    }

    // The tarball boundary, which is independent: `files` overrides `.gitignore`, so saying it
    // once is not saying it twice.
    const { files } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] };
    const dir = mkdtempSync(join(tmpdir(), 'packing-rules-'));
    try {
      mkdirSync(join(dir, 'templates/research/targets/desktop'), { recursive: true });
      mkdirSync(join(dir, 'templates/research/targets/web'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'packing-rules', version: '0.0.0', files }));
      writeFileSync(join(dir, local), 'CSC_KEY_PASSWORD=SYNTHETIC-CREDENTIAL\n');
      writeFileSync(join(dir, overlay), '{"note":"SYNTHETIC-CREDENTIAL"}\n');
      writeFileSync(join(dir, other), 'token=SYNTHETIC-CREDENTIAL\n');
      writeFileSync(join(dir, 'templates/research/targets/web/.env'), 'PORT=8787\n');

      const packed = (JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as
        Array<{ files: Array<{ path: string }> }>)[0].files.map((f) => f.path);

      expect(packed.some((f) => f.endsWith('.env.local'))).toBe(false);
      expect(packed.some((f) => f.endsWith('harness.json'))).toBe(false);
      expect(packed.some((f) => f.endsWith('.local'))).toBe(false);
      // …and the committed file that documents where credentials go still ships.
      expect(packed).toContain('templates/research/targets/web/.env');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
