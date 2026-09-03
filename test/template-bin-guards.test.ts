/**
 * The two guards a scaffolded project carries in `bin/`, exercised the only
 * honest way: as subprocesses against a fixture `package.json`. Both are plain
 * node scripts with top-level `await import` — importing them into vitest would
 * test something other than what ships.
 *
 * `preflight-abilities.js` runs ahead of the compiler and answers ONE question: were
 * this harness's Abilities ever vendored? `run.js` runs at boot and classifies a
 * real `ERR_MODULE_NOT_FOUND` — the regression it guards is claiming "Abilities
 * are not installed" for an unbuilt `dist/` or any un-installed dependency,
 * which points the user at a command that cannot help.
 *
 * Fixtures use the `basic` template's copies. `research` carries its own
 * bin/ (dist entry and serve shim differ); nothing asserted here depends on
 * those differences — both templates' guards answer the same two questions.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASIC_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'basic', 'bin');

const created: string[] = [];
afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

/** A throwaway project: both guards in `bin/`, a package.json, optional files. */
function fixture(pkg: Record<string, unknown>, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'tmpl-guard-'));
  created.push(dir);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  for (const f of ['preflight-abilities.js', 'run.js']) {
    copyFileSync(join(BASIC_BIN, f), join(dir, 'bin', f));
  }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const [rel, body] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  return dir;
}

function run(dir: string, script: string): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [join(dir, 'bin', script)], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}

const WIKIPEDIA = 'lloyal/wikipedia@2.0.0';
const VENDORED = 'file:vendor/lloyal__wikipedia-2.0.0.tgz';

describe('preflight-abilities.js', () => {
  it('fails with the install line when a recorded ability was never vendored', () => {
    const dir = fixture({
      name: 'p',
      type: 'module',
      harnessdev: { template: 'basic', targets: ['cli'], abilities: [WIKIPEDIA] },
    });
    const { status, stderr } = run(dir, 'preflight-abilities.js');
    expect(status).toBe(1);
    expect(stderr).toContain(`npx lloyal-ai install ${WIKIPEDIA}`);
  });

  it('passes when a dependency points at the spec’s vendored tarball', () => {
    const dir = fixture({
      name: 'p',
      type: 'module',
      dependencies: { '@lloyal-labs/wikipedia-ability': VENDORED },
      harnessdev: { template: 'basic', targets: ['cli'], abilities: [WIKIPEDIA] },
    });
    expect(run(dir, 'preflight-abilities.js').status).toBe(0);
  });

  it('names only the missing ability when others are satisfied', () => {
    const dir = fixture({
      name: 'p',
      type: 'module',
      dependencies: { '@lloyal-labs/corpus-ability': 'file:vendor/lloyal__corpus-2.0.0.tgz' },
      harnessdev: {
        template: 'research',
        targets: ['cli'],
        abilities: ['lloyal/corpus@2.0.0', 'lloyal/web@2.0.0'],
      },
    });
    const { status, stderr } = run(dir, 'preflight-abilities.js');
    expect(status).toBe(1);
    expect(stderr).toContain('npx lloyal-ai install lloyal/web@2.0.0');
    expect(stderr).not.toContain('lloyal/corpus@2.0.0');
  });

  it('passes when the marker records no abilities — absent means UNKNOWN, not none', () => {
    // A hand-written project, or one predating the `abilities` marker, must not be
    // blocked by a guard that has nothing to check.
    expect(run(fixture({ name: 'p', type: 'module' }), 'preflight-abilities.js').status).toBe(0);
  });

  it('never calls an unparseable spec missing', () => {
    const dir = fixture({
      name: 'p',
      type: 'module',
      harnessdev: { template: 'basic', targets: ['cli'], abilities: ['not-a-valid-spec'] },
    });
    expect(run(dir, 'preflight-abilities.js').status).toBe(0);
  });
});

describe('run.js — classifies ERR_MODULE_NOT_FOUND before advising', () => {
  const withAbility = (deps?: Record<string, string>): Record<string, unknown> => ({
    name: 'p',
    type: 'module',
    ...(deps ? { dependencies: deps } : {}),
    harnessdev: { template: 'basic', targets: ['cli'], abilities: [WIKIPEDIA] },
  });

  it('an unbuilt dist is a build problem, not a missing Ability', () => {
    // The regression: this path used to print `lloyal install`, which
    // cannot fix an unbuilt project.
    const { status, stderr } = run(fixture(withAbility()), 'run.js');
    expect(status).toBe(1);
    expect(stderr).toContain('npm run build');
    expect(stderr).not.toContain('lloyal install');
  });

  it('a bare specifier absent from dependencies is the Ability case', () => {
    const dir = fixture(withAbility(), {
      'dist/targets/cli/index.js': 'import "@lloyal-labs/wikipedia-ability";\n',
    });
    const { status, stderr } = run(dir, 'run.js');
    expect(status).toBe(1);
    expect(stderr).toContain('is not a dependency of this project');
    expect(stderr).toContain(`npx lloyal-ai install ${WIKIPEDIA}`);
  });

  it('a bare specifier that IS a dependency means npm install, not install-ability', () => {
    const dir = fixture(withAbility({ '@lloyal-labs/wikipedia-ability': VENDORED }), {
      'dist/targets/cli/index.js': 'import "@lloyal-labs/wikipedia-ability";\n',
    });
    const { status, stderr } = run(dir, 'run.js');
    expect(status).toBe(1);
    expect(stderr).toContain('is a dependency but is not installed');
    expect(stderr).not.toContain('lloyal install');
  });

  it('rethrows anything that is not ERR_MODULE_NOT_FOUND', () => {
    const dir = fixture(withAbility(), {
      'dist/targets/cli/index.js': 'throw new Error("harness boom");\n',
    });
    const { status, stderr } = run(dir, 'run.js');
    expect(status).toBe(1);
    expect(stderr).toContain('harness boom');
    expect(stderr).not.toContain('lloyal install');
  });
});
