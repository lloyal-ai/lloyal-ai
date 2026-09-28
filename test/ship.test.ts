/**
 * `lloyal ship` — everything that can be settled without building an application.
 *
 * The packaged gate (does the utility process start, read the seeded manifest and render a bundled
 * prompt?) is a real dmg on a real Mac and lives outside this suite. What is here is the matrix
 * around it: what an identifier may be, what the verb refuses and what it says when it refuses, and
 * the three things that are true of an image depending on what the machine could sign it with.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTreeWithSubstitutions } from '../src/scaffold/copy-tree.js';
import { openHarnessYml } from '../src/scaffold/harness-yml.js';
import { canDistribute, distributionRefusal, hasCertificate, notaryArgs, notaryRoute, signingFrom } from '../src/scaffold/ship-config.js';
import { iconRefusal, notarizeFailure, report, shipCommand, slugOf, validAppId, whatToAdd } from '../src/commands/ship.js';

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

/**
 * Run the verb in a project, with nobody to ask, on a stated platform.
 *
 * The platform is stated rather than inherited because the verb refuses on a non-darwin host BEFORE
 * it looks at anything else, so on a Linux or Windows runner every row about the other refusals
 * would get the macOS message instead of the one it is about. This suite runs on all three.
 */
async function shipIn(dir: string, argv: string[] = [], platform: NodeJS.Platform = 'darwin'): Promise<{ code: number; said: string }> {
  const prevDir = process.cwd();
  const prevTty = process.stdin.isTTY;
  const prevPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  let said = '';
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    said += chunk.toString();
    return true;
  });
  process.chdir(dir);
  (process.stdin as { isTTY?: boolean }).isTTY = false;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return { code: await shipCommand.run(argv), said };
  } finally {
    if (prevPlatform) Object.defineProperty(process, 'platform', prevPlatform);
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
    const { code, said } = await shipIn(project(), [], 'linux');
    expect(code).toBe(1);
    expect(said).toContain('only be built on macOS');
    expect(said).toContain('linux');
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
  it('uses an App Store Connect key when that is what the machine has', () => {
    expect(
      notaryArgs({ APPLE_API_KEY: '/k/AuthKey_X.p8', APPLE_API_KEY_ID: 'KID', APPLE_API_ISSUER: 'ISS' }),
    ).toEqual(['--key', '/k/AuthKey_X.p8', '--key-id', 'KID', '--issuer', 'ISS']);
  });

  /** A stored profile keeps the secret in the keychain, so nothing sensitive reaches a command line. */
  it('uses a keychain profile, and the keychain holding it when one is named', () => {
    expect(notaryArgs({ APPLE_KEYCHAIN_PROFILE: 'lloyal' })).toEqual(['--keychain-profile', 'lloyal']);
    expect(notaryArgs({ APPLE_KEYCHAIN_PROFILE: 'lloyal', APPLE_KEYCHAIN: '/k/login.keychain-db' }))
      .toEqual(['--keychain-profile', 'lloyal', '--keychain', '/k/login.keychain-db']);
  });

  /**
   * The packager notarizes the application from the same environment and picks in this order. If
   * this disagreed, a machine holding two sets would ship an app notarized under one account inside
   * an image notarized under another — working, and invisible when it stopped working.
   */
  it('picks in the same order the packager does, so both halves use one account', () => {
    const all = {
      APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_TEAM_ID: 'T',
      APPLE_API_KEY: '/k/x.p8', APPLE_API_KEY_ID: 'KID', APPLE_API_ISSUER: 'ISS',
      APPLE_KEYCHAIN_PROFILE: 'lloyal',
    };
    expect(notaryRoute(all)).toBe('apple-id');
    const { APPLE_ID: _id, APPLE_APP_SPECIFIC_PASSWORD: _pw, ...noAppleId } = all;
    expect(notaryRoute(noAppleId)).toBe('api-key');
    expect(notaryRoute({ APPLE_KEYCHAIN_PROFILE: 'lloyal' })).toBe('keychain-profile');
    expect(notaryRoute({})).toBeNull();
  });

  /**
   * A variable that is SET AND EMPTY, which is what an absent CI secret interpolates to. Under `??`
   * an empty value counts as an answer, so `CSC_LINK=''` masked a real `CSC_NAME` and turned signing
   * off, and an empty `APPLE_API_KEY` masked a real key id and issuer and skipped notarization. The
   * packager reads the same variables with `||`; anything else makes the two disagree.
   */
  describe('a variable that is set and empty', () => {
    it('does not mask the one behind it when looking for a certificate', () => {
      expect(hasCertificate({ CSC_LINK: '', CSC_NAME: 'Developer ID Application: Someone (T)' })).toBe(true);
      expect(hasCertificate({ CSC_LINK: '', CSC_NAME: '' })).toBe(false);
      expect(hasCertificate({})).toBe(false);
    });

    it('does not send an incomplete API key set down another route', () => {
      expect(notaryRoute({ APPLE_API_KEY: '', APPLE_API_KEY_ID: 'KID', APPLE_API_ISSUER: 'ISS' })).toBe('api-key');
      // …and being on that route is what makes the missing one get named, rather than silently skipped.
      expect(() => notaryArgs({ APPLE_API_KEY: '', APPLE_API_KEY_ID: 'KID', APPLE_API_ISSUER: 'ISS' })).toThrow('APPLE_API_KEY');
    });

    it('does not send an incomplete Apple ID set down another route', () => {
      expect(notaryRoute({ APPLE_ID: '', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_TEAM_ID: 'T' })).toBe('apple-id');
      expect(() => notaryArgs({ APPLE_ID: '', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_TEAM_ID: 'T' })).toThrow('APPLE_ID');
    });

    it('is not mistaken for credentials when every one of them is empty', () => {
      expect(notaryRoute({ APPLE_ID: '', APPLE_API_KEY: '', APPLE_KEYCHAIN_PROFILE: '' })).toBeNull();
      expect(canDistribute({ CSC_LINK: '', APPLE_API_KEY: '' })).toBe(false);
    });
  });

  it('counts a keychain profile as credentials, so a machine holding one is ready', () => {
    expect(canDistribute({ CSC_LINK: 'x', APPLE_KEYCHAIN_PROFILE: 'lloyal' })).toBe(true);
    expect(canDistribute({ APPLE_KEYCHAIN_PROFILE: 'lloyal' })).toBe(false);
  });

  it('uses an Apple ID with an app-specific password', () => {
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
  const said_ = (env: NodeJS.ProcessEnv, asked = false, icon?: string) =>
    report({
      product: 'Fieldnote', version: '0.3.1', images: image,
      signing: signingFrom(env, asked), ready: canDistribute(env),
      ...(icon !== undefined ? { icon } : {}),
    });

  it('unsigned on a machine with nothing: what a distributable build takes', () => {
    const said = said_({});
    expect(said).toContain('release/Fieldnote-0.3.1-arm64.dmg');
    expect(said).toContain('127 MB');
    expect(said).toContain('Unsigned');
    expect(said).toContain('--notarize');
  });

  /** Forgetting the flag and lacking an Apple account want opposite advice, and the difference is
   *  knowable, so the report tells them apart rather than reciting variables at both. */
  it('unsigned on a machine that is ready: the flag, not a list of variables', () => {
    const said = said_({ CSC_NAME: 'Developer ID Application: Someone (T)', APPLE_KEYCHAIN_PROFILE: 'lloyal' });
    expect(said).toContain('holds the credentials');
    expect(said).toContain('--notarize');
    expect(said).not.toContain('CSC_LINK');
  });

  it('notarized: how to check it before it goes out', () => {
    const said = said_({ CSC_LINK: 'base64…', APPLE_API_KEY: '/k/x.p8', APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I' }, true);
    expect(said).toContain('stapler validate');
    expect(said).not.toContain('--notarize');
  });

  /** The icon is the one thing ship completes unasked, so it is the one thing that can surprise a
   *  reader who never chose it. Either way the report says where it came from. */
  it('names the icon it used, and how to change it', () => {
    const said = said_({}, false, 'build/icon.icns');
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

/**
 * A rejected notarisation must not print the credential that was rejected.
 *
 * The submission's argv carries the app-specific password, and `execFileSync` puts the entire
 * command line into its error message. Building the failure from that message — which is what this
 * did — wrote the password to stderr and into whatever captured it.
 */
describe('a failed notarisation', () => {
  it('says which phase failed and what it exited with', () => {
    const said = notarizeFailure('/r/Fieldnote-1.0.0-arm64.dmg', 'xcrun notarytool submit', 2);
    expect(said).toContain('Fieldnote-1.0.0-arm64.dmg');
    expect(said).toContain('xcrun notarytool submit');
    expect(said).toContain('exit 2');
    // The app inside is already stapled; only the wrapper is not. A reader has to be told which.
    expect(said).toContain('The application inside the image is notarized');
  });

  it('says nothing about an exit status it does not have', () => {
    expect(notarizeFailure('/r/x.dmg', 'xcrun stapler staple', null)).not.toContain('exit');
  });

  /** The defect, reproduced: a real subprocess failure whose argv holds a password. Only the exit
   *  status may cross into the message, which is why the function cannot be handed the cause. */
  it('cannot carry the password out of the subprocess error', () => {
    const secret = 'abcd-efgh-ijkl-mnop';
    let status: number | null = null;
    let raw = '';
    try {
      // `--` so node runs the script and the password is an argument to it, exactly as notarytool
      // would be given one, rather than node rejecting an unknown flag.
      execFileSync(process.execPath, ['-e', 'process.exit(3)', '--', '--password', secret]);
    } catch (cause) {
      raw = (cause as Error).message;
      const s = (cause as { status?: unknown }).status;
      status = typeof s === 'number' ? s : null;
    }
    // The raw error is what used to be interpolated, and it does hold the secret.
    expect(raw).toContain(secret);
    expect(status).toBe(3);
    const said = notarizeFailure('/r/x.dmg', 'xcrun notarytool submit', status);
    expect(said).not.toContain(secret);
    expect(said).toContain('exit 3');
  });
});

/**
 * An icon that merely exists is not an icon. The `.svg` case is the sharp one: it does not fail, it
 * ships a blank tile and warns about nothing, so it has to be refused by name rather than left to
 * the packager.
 */
describe('an icon the project names', () => {
  const dir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'icon-'));
    created.push(d);
    return d;
  };

  it('accepts a .icns and a .png', () => {
    const d = dir();
    for (const name of ['icon.icns', 'icon.png', 'icon.PNG']) {
      writeFileSync(join(d, name), 'x');
      expect(iconRefusal(join(d, name), `build/${name}`)).toBeUndefined();
    }
  });

  it('refuses one that is not there, and names it', () => {
    expect(iconRefusal(join(dir(), 'gone.icns'), 'build/gone.icns')).toContain('build/gone.icns');
  });

  it('refuses a directory, which an existence check would have passed', () => {
    const d = dir();
    mkdirSync(join(d, 'icon.icns'));
    expect(iconRefusal(join(d, 'icon.icns'), 'build/icon.icns')).toContain('not a file');
  });

  /** The defect this exists for: it builds, it ships, and the tile is empty. */
  it('refuses an SVG and says why, since the packager would not', () => {
    const d = dir();
    writeFileSync(join(d, 'icon.svg'), '<svg/>');
    const said = iconRefusal(join(d, 'icon.svg'), 'build/icon.svg');
    expect(said).toContain('blank tile');
    expect(said).toContain('512px');
  });

  it('refuses anything else by saying what an icon may be', () => {
    const d = dir();
    writeFileSync(join(d, 'icon.jpg'), 'x');
    expect(iconRefusal(join(d, 'icon.jpg'), 'build/icon.jpg')).toContain('.icns nor a .png');
  });
});

/**
 * Nothing is signed unless it was asked for.
 *
 * Intent is not in the environment, and inferring it there is how an artifact comes out unsigned
 * while everyone believes otherwise — one variable left over from another project is enough. So the
 * flag decides, the environment supplies, and a request that cannot be met is refused rather than
 * quietly downgraded to the thing nobody can install.
 */
describe('--notarize is the asking', () => {
  const complete = { CSC_NAME: 'Developer ID Application: Someone (T)', APPLE_KEYCHAIN_PROFILE: 'lloyal' };

  it('signs nothing when it was not asked, however well the machine is set up', () => {
    expect(signingFrom(complete, false)).toEqual({ sign: false, notarize: false });
    expect(canDistribute(complete)).toBe(true);
  });

  it('signs and notarizes together when it was asked and can be met', () => {
    expect(signingFrom(complete, true)).toEqual({ sign: true, notarize: true });
  });

  /** Apple's notary service only accepts a submission already signed, so there is no third state to
   *  reach: asked-but-incomplete is refused by the command before this is consulted. */
  it('never claims one without the other', () => {
    for (const env of [{}, { CSC_NAME: 'x' }, { APPLE_KEYCHAIN_PROFILE: 'l' }, complete]) {
      for (const asked of [true, false]) {
        const { sign, notarize } = signingFrom(env, asked);
        expect(sign).toBe(notarize);
      }
    }
  });

  it('is content when the machine has both', () => {
    expect(distributionRefusal(complete)).toBeUndefined();
  });

  it('names what is missing, one or both', () => {
    expect(distributionRefusal({})).toContain('a Developer ID certificate and notary credentials');
    expect(distributionRefusal({})).toContain('neither');
    expect(distributionRefusal({ CSC_NAME: 'x' })).toContain('notary credentials');
    expect(distributionRefusal({ CSC_NAME: 'x' })).toContain('none');
    expect(distributionRefusal({ APPLE_KEYCHAIN_PROFILE: 'l' })).toContain('a Developer ID certificate');
  });

  /** The refusal is the documentation: no scaffold gains an example file nobody opens, and the
   *  routes that leave no secret on disk are the ones printed first. */
  it('is the thing to paste, secret-free routes first', () => {
    const said = distributionRefusal({}) as string;
    expect(said).toContain('.env.local');
    expect(said.indexOf('APPLE_KEYCHAIN_PROFILE')).toBeLessThan(said.indexOf('CSC_LINK'));
    expect(said).toContain('store-credentials');
  });
});
