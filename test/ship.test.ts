/**
 * `lloyal ship` — everything that can be settled without building an application.
 *
 * The packaged gate (does the utility process start, read the seeded manifest and render a bundled
 * prompt?) is a real dmg on a real Mac and lives outside this suite. What is here is the matrix
 * around it: what an identifier may be, what the verb refuses and what it says when it refuses, and
 * the three things that are true of an image depending on what the machine could sign it with.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTreeWithSubstitutions } from '../src/scaffold/copy-tree.js';
import { openHarnessYml } from '../src/scaffold/harness-yml.js';
import { notaryArgs, signingFrom } from '../src/scaffold/ship-config.js';
import { report, shipCommand, slugOf, validAppId, whatToAdd } from '../src/commands/ship.js';

const BASIC_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'basic');

const created: string[] = [];

/** A project that looks like a scaffold: a manifest, a name, a version, a desktop surface. */
function project(edit: (dir: string) => void = () => {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'ship-proj-'));
  created.push(dir);
  // Copied the way `new` copies it, which is the only copier that knows a template's `node_modules`
  // is never part of one — a checkout that has installed into a template carries 200MB of it.
  copyTreeWithSubstitutions(BASIC_TEMPLATE, dir, {});
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  pkg.name = 'fieldnote';
  pkg.version = '0.3.1';
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(
    join(dir, 'src', 'ui', 'presentation.ts'),
    'export const APP = { name: "Fieldnote" } as const;\n',
  );
  edit(dir);
  return dir;
}

/** Run the verb in a project, with nobody to ask. */
async function shipIn(dir: string, argv: string[] = []): Promise<{ code: number; said: string }> {
  const prevDir = process.cwd();
  const prevTty = process.stdin.isTTY;
  let said = '';
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    said += chunk.toString();
    return true;
  });
  process.chdir(dir);
  (process.stdin as { isTTY?: boolean }).isTTY = false;
  try {
    return { code: await shipCommand.run(argv), said };
  } finally {
    (process.stdin as { isTTY?: boolean }).isTTY = prevTty;
    process.chdir(prevDir);
    spy.mockRestore();
  }
}

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('an application identifier', () => {
  it.each(['com.acme.fieldnote', 'ai.lloyal.artifact', 'io.github.a-b.c-d', 'a.b'])('accepts %s', (id) => {
    expect(validAppId(id)).toBe(true);
  });

  /** Each of these fails at codesign time or in the App Store, a long way from where it was typed. */
  it.each([
    ['fieldnote', 'no dot, so it is not reverse-domain'],
    ['com..fieldnote', 'an empty part'],
    ['com.acme.field note', 'a space'],
    ['com.acme.field_note', 'an underscore, which Apple does not accept'],
    ['1com.acme', 'a leading digit'],
    ['com.acme.', 'a trailing dot'],
    ['', 'nothing at all'],
  ])('refuses %s (%s)', (id) => {
    expect(validAppId(id)).toBe(false);
  });
});

describe('the example in a question or a refusal', () => {
  it('reduces a scoped package name to its tail', () => {
    expect(slugOf('@acme/field-note')).toBe('field-note');
  });

  it('reduces the scaffold placeholder to something an identifier can hold', () => {
    expect(validAppId(`com.yourcompany.${slugOf('__NAME__')}`)).toBe(true);
  });

  it('never produces an example the verb would then refuse', () => {
    for (const name of ['@a/_b_', 'UPPER Case', '---', 'ok']) {
      expect(validAppId(`com.yourcompany.${slugOf(name)}`)).toBe(true);
    }
  });

  it('names the file and the block to add', () => {
    const said = whatToAdd('fieldnote');
    expect(said).toContain('harness.yml');
    expect(said).toContain('ship:');
    expect(said).toContain('id: com.yourcompany.fieldnote');
  });
});

describe('refusing before anything is built', () => {
  it('names `ship.id` and prints the block when there is nobody to ask', async () => {
    const dir = project();
    const { code, said } = await shipIn(dir);
    expect(code).toBe(1);
    expect(said).toContain('names no `ship.id`');
    expect(said).toContain('stdin is not a terminal');
    expect(said).toContain('id: com.yourcompany.fieldnote');
    // It stopped before the build, so there is no output tree and no image.
    expect(existsSync(join(dir, 'release'))).toBe(false);
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });

  it('says a declared identifier is not one, rather than packaging with it', async () => {
    const dir = project((d) => {
      const yml = openHarnessYml(d);
      yml.set(['ship', 'id'], 'Field Note');
      yml.save();
    });
    const { code, said } = await shipIn(dir);
    expect(code).toBe(1);
    expect(said).toContain('`ship.id: Field Note`');
    expect(said).toContain('id: com.yourcompany.fieldnote');
  });

  it('names an icon the manifest promises and the project does not have', async () => {
    const dir = project((d) => {
      const yml = openHarnessYml(d);
      yml.set(['ship', 'id'], 'com.acme.fieldnote');
      yml.set(['ship', 'icon'], 'build/not-here.icns');
      yml.save();
    });
    const { code, said } = await shipIn(dir);
    expect(code).toBe(1);
    expect(said).toContain('build/not-here.icns');
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });

  it('sends a project with no desktop surface to `targets:add`', async () => {
    const dir = project((d) => {
      const pkg = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
      delete pkg.scripts['build:desktop'];
      writeFileSync(join(d, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    });
    const { code, said } = await shipIn(dir);
    expect(code).toBe(1);
    expect(said).toContain('targets:add desktop');
  });

  it('says so on a machine that cannot build a macOS application', async () => {
    const dir = project();
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const { code, said } = await shipIn(dir);
      expect(code).toBe(1);
      expect(said).toContain('only be built on macOS');
      expect(said).toContain('linux');
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });

  it('is not a harness project at all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ship-bare-'));
    created.push(dir);
    const { code, said } = await shipIn(dir);
    expect(code).toBe(1);
    expect(said).toContain('not a harness project');
  });

  it('--help says how signing is turned on, and builds nothing', async () => {
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out += chunk.toString();
      return true;
    });
    expect(await shipCommand.run(['--help'])).toBe(0);
    expect(out).toContain('CSC_LINK');
    expect(out).toContain('APPLE_API_KEY');
  });
});

/**
 * The block is the developer's answer, kept where the rest of the project's declarations are. rig
 * reads `harness.yml` through a declared table of keys and ignores what is not in it, so a `ship:`
 * block is inert to a run — which is the only reason it can live here.
 */
describe('the `ship:` block in the manifest', () => {
  it('is written without disturbing what was already there', () => {
    const dir = project();
    const before = readFileSync(join(dir, 'harness.yml'), 'utf8');
    expect(before).toContain('id: qwen3.5-4b');
    const yml = openHarnessYml(dir);
    yml.set(['ship', 'id'], 'com.acme.fieldnote');
    yml.set(['ship', 'icon'], 'build/icon.icns');
    yml.save();
    const after = readFileSync(join(dir, 'harness.yml'), 'utf8');
    expect(after).toContain('targets: [cli, desktop, web]');
    expect(after).toContain('id: qwen3.5-4b');
    expect(after).toContain('context: 32768');
    const reread = openHarnessYml(dir);
    expect(reread.get(['ship', 'id'])).toBe('com.acme.fieldnote');
    expect(reread.get(['ship', 'icon'])).toBe('build/icon.icns');
    expect(reread.get(['model', 'llm', 'id'])).toBe('qwen3.5-4b');
  });

  it('keeps a hand-written comment beside a key it did not touch', () => {
    const dir = project((d) => {
      writeFileSync(join(d, 'harness.yml'), 'model:\n  llm:\n    # this machine cannot hold more\n    context: 8192\n');
    });
    const yml = openHarnessYml(dir);
    yml.set(['ship', 'id'], 'com.acme.fieldnote');
    yml.save();
    expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toContain('# this machine cannot hold more');
  });
});

describe('what notarytool is authenticated with', () => {
  it('prefers an App Store Connect key', () => {
    expect(
      notaryArgs({ APPLE_API_KEY: '/k/AuthKey_X.p8', APPLE_API_KEY_ID: 'KID', APPLE_API_ISSUER: 'ISS', APPLE_ID: 'a@b.c' }),
    ).toEqual(['--key', '/k/AuthKey_X.p8', '--key-id', 'KID', '--issuer', 'ISS']);
  });

  it('falls back to an Apple ID with an app-specific password', () => {
    expect(notaryArgs({ APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'x-y-z', APPLE_TEAM_ID: 'TEAM' })).toEqual([
      '--apple-id', 'a@b.c', '--password', 'x-y-z', '--team-id', 'TEAM',
    ]);
  });

  /** Half a set of credentials is the expensive failure: it arrives at the end of a long build. */
  it('names the variable that is missing rather than passing an empty one', () => {
    expect(() => notaryArgs({ APPLE_API_KEY: '/k/AuthKey_X.p8', APPLE_API_KEY_ID: 'KID' })).toThrow('APPLE_API_ISSUER');
    expect(() => notaryArgs({ APPLE_ID: 'a@b.c' })).toThrow('APPLE_APP_SPECIFIC_PASSWORD');
  });
});

describe('what the report says is true of the image', () => {
  const image = [{ path: 'release/Fieldnote-0.3.1-arm64.dmg', bytes: 127_400_000 }];
  const said_ = (env: NodeJS.ProcessEnv, icon?: string) =>
    report({ product: 'Fieldnote', version: '0.3.1', images: image, signing: signingFrom(env), ...(icon !== undefined ? { icon } : {}) });

  it('unsigned: where it works, and the two variables that change that', () => {
    const said = said_({});
    expect(said).toContain('release/Fieldnote-0.3.1-arm64.dmg');
    expect(said).toContain('127 MB');
    expect(said).toContain('Unsigned');
    expect(said).toContain('CSC_LINK');
    expect(said).toContain('APPLE_API_KEY');
  });

  it('signed and not notarized: a browser download still refuses it', () => {
    const said = said_({ CSC_LINK: 'base64…' });
    expect(said).toContain('not notarized');
    expect(said).toContain('APPLE_APP_SPECIFIC_PASSWORD');
    expect(said).not.toContain('CSC_LINK');
  });

  it('notarized: how to check it before handing it over', () => {
    const said = said_({ CSC_LINK: 'base64…', APPLE_API_KEY: '/k/x.p8' });
    expect(said).toContain('stapler validate');
    expect(said).not.toContain('CSC_LINK');
  });

  /** The icon is the one thing ship completes unasked, so it is the one thing that can surprise a
   *  reader who never chose it. Either way the report says where it came from. */
  it('names the icon it used, and how to change it', () => {
    const said = said_({}, 'build/icon.icns');
    expect(said).toContain('Icon: build/icon.icns');
    expect(said).toContain('ship.icon');
    expect(said).not.toContain('wears Electron');
  });

  it('says where to put one when the app ends up wearing Electron\'s', () => {
    const said = said_({});
    expect(said).toContain("wears Electron's");
    expect(said).toContain('build/icon.icns');
    expect(said).toContain('512px');
  });

  it('always says the weights are not inside, and that this is macOS', () => {
    for (const env of [{}, { CSC_LINK: 'x' }, { CSC_LINK: 'x', APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'b' }]) {
      const said = said_(env);
      expect(said).toContain('No weights are inside');
      expect(said).toContain('macOS');
    }
  });
});
