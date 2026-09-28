/**
 * `lloyal ship` — this harness becomes an application someone else can install.
 *
 * `build:desktop` writes `out/{main,preload,renderer}` and stops, which runs on the machine it was
 * built on and can be handed to nobody. This is the rest of the way: a disk image carrying the
 * engine, its dependencies, its prompts and the manifest, that a reader drags into Applications.
 *
 * None of the packaging lands in the project. The developer declares the two facts that are
 * genuinely theirs — the application identifier and an icon — and everything else is synthesised
 * ({@link ../scaffold/ship-config}) into a config handed to the packager and then thrown away. The
 * two facts are asked once and kept in `harness.yml`, so a second run asks nothing, and so does a
 * colleague's checkout.
 *
 * The weights are not inside it. The installed app acquires every model it is configured for on
 * first launch, through the same installer a development run uses, into the writable folder the
 * platform gives each installation.
 *
 * macOS only, and said rather than discovered: Windows and Linux each need their own machine to
 * build on and their own signing story.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Command } from '../command.js';
import { npmExit } from '../npm-spawn.js';
import { HARNESS_YML, openHarnessYml } from '../scaffold/harness-yml.js';
import { readPackageJson } from '../scaffold/package-json.js';
import { harnessProjectRoot } from '../scaffold/project.js';
import { ENTITLEMENTS, harnessPackaging, notaryArgs, signingFrom, type Signing } from '../scaffold/ship-config.js';
import { interactive } from '../scaffold/terminal.js';

const USAGE = [
  'lloyal ship — package this harness as an application you can hand to someone',
  '',
  'Usage:',
  '  lloyal ship',
  '',
  'Builds the desktop surface and wraps it as a macOS disk image in release/. The first run asks for',
  'an application identifier and, if you have one, an icon, and keeps both in harness.yml; later runs',
  'ask nothing. No model weights go inside — the app acquires what it needs on first launch.',
  '',
  'Signing is read from the environment rather than a flag, so the same command produces an unsigned',
  'image on a machine with no Apple account and a notarized one on a machine with credentials:',
  '',
  '  CSC_LINK + CSC_KEY_PASSWORD   base64 of a Developer ID Application .p12, and its password',
  '  APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER   an App Store Connect key, to notarize',
  '  APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID   the same thing with an Apple ID',
  '',
  'Unsigned is fine for looking at the result on this Mac. Any other Mac needs both.',
].join('\n');

/**
 * The packager, by exact version.
 *
 * It arrives on demand rather than as a dependency of this CLI, because it is tens of megabytes of
 * machinery that only this one verb uses. A RANGE here would be a version nobody chose: the packager
 * could change under a project on a machine that has never run this before, with no release of this
 * CLI to explain it. 26.15.3 is what our own signed, notarized application is built with.
 */
const PACKAGER = 'electron-builder@26.15.3';

/** Where the images land. Never `dist/`, which belongs to the engine. */
const OUTPUT = 'release';

/** Two or more dot-separated parts of letters, digits and hyphens, beginning with a letter. */
const ID_SHAPE = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/;

/** Is this a bundle identifier? Not a taste question: the keychain, Gatekeeper and the App Store all
 *  key on it, and a value they reject fails at codesign time or later. */
export const validAppId = (id: string): boolean => ID_SHAPE.test(id);

/** The project's own name, reduced to something that can sit inside an identifier — for the example
 *  in a question or a refusal, never for the answer itself. */
export function slugOf(name: string): string {
  const tail = name.split('/').pop() ?? name;
  return tail.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

/** What to write by hand. Said whenever this cannot ask — a pipe, CI, a script. */
export function whatToAdd(slug: string): string {
  return [
    `Add this to ${HARNESS_YML} and run it again:`,
    '',
    'ship:',
    `  id: com.yourcompany.${slug}`,
    '',
    'An `icon:` beside it is a .icns or a square .png of at least 512px. The templates ship one at',
    '`build/icon.icns`; replace that file to change it, or name another here.',
  ].join('\n');
}

/**
 * Why this icon cannot be used, or nothing.
 *
 * Existing is not enough. A directory passes an existence check and fails deep inside the packager;
 * an `.svg` passes it and is WORSE THAN A FAILURE, because the packager's rasteriser draws paths and
 * not type, so a mark made of lettering ships as a blank tile with no warning anywhere in the build.
 * Both are cheap to catch here and expensive to find later — the second only by looking at the Dock.
 */
export function iconRefusal(resolved: string, asWritten: string): string | undefined {
  let file;
  try {
    file = statSync(resolved);
  } catch {
    return `${HARNESS_YML} names an icon that is not there: ${asWritten}`;
  }
  if (!file.isFile()) return `${HARNESS_YML} names an icon that is not a file: ${asWritten}`;
  const ext = extname(resolved).toLowerCase();
  if (ext === '.svg') {
    return (
      `${asWritten} is an SVG, and the packager rasterises one with a renderer that draws paths and not type.\n` +
      'A mark made of lettering would ship as a blank tile and nothing would warn you. Render it to a\n' +
      'square .png of at least 512px, or a .icns, and name that instead.'
    );
  }
  if (ext !== '.icns' && ext !== '.png') {
    return `${asWritten} is neither a .icns nor a .png, and those are what an application icon may be.`;
  }
  return undefined;
}

/** A value only if it says something. A blank scalar is a key somebody started and left. */
const asText = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

const asMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * What the application is called, from the one place a harness says so.
 *
 * Imported rather than parsed. `src/ui/presentation.ts` is node-free, side-effect-free and erasable
 * by design — every surface reads the name from it — so Node strips its types and hands back the
 * value, and no harness starts.
 */
async function productName(root: string): Promise<string> {
  const file = join(root, 'src', 'ui', 'presentation.ts');
  const where = 'src/ui/presentation.ts';
  let mod: { APP?: { name?: unknown } };
  try {
    mod = (await import(pathToFileURL(file).href)) as { APP?: { name?: unknown } };
  } catch (cause) {
    throw new Error(`could not read ${where}, where a harness says what it is called: ${asMessage(cause)}`);
  }
  const name = asText(mod.APP?.name);
  if (name === undefined) throw new Error(`${where} exports no \`APP.name\` — that is where this harness says what it is called.`);
  return name;
}

/** What this project declares about shipping, or does not. */
interface Declared {
  id?: string;
  icon?: string;
}

/**
 * Ask for what a packager cannot infer, drawn on stderr like every other asked write, and answered
 * once. An empty identifier is a decision to stop, not a default to invent.
 */
async function askIdentity(root: string, product: string, slug: string, hasIcon: boolean, invalid?: string): Promise<Declared & { id: string }> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(
      invalid === undefined
        ? `Packaging ${product} needs ${hasIcon ? 'one thing this project does not say' : 'two things this project does not say'} yet. ` +
          `It is kept in ${HARNESS_YML}, so this is asked once.\n\n`
        : `${HARNESS_YML} says \`ship.id: ${invalid}\`, which no Mac will accept as an application identifier.\n\n`,
    );
    let id: string | undefined;
    while (id === undefined) {
      const answer = (await rl.question(`  application id — reverse-domain, yours alone (e.g. com.yourcompany.${slug}): `)).trim();
      if (answer === '') throw new Error(`there is nothing to package without an application id.\n\n${whatToAdd(slug)}`);
      if (!validAppId(answer)) {
        process.stderr.write('    two or more parts separated by dots, of letters, digits and hyphens. Again:\n');
        continue;
      }
      id = answer;
    }
    // The templates ship a default mark, so most projects already have one and being asked would be
    // noise. Only a project that has none is asked, and it may decline.
    if (hasIcon) return { id };
    for (;;) {
      const answer = (await rl.question("  icon — a .icns, or a square .png of at least 512px, or blank for Electron's own: ")).trim();
      if (answer === '') return { id };
      if (existsSync(resolve(root, answer))) return { id, icon: answer };
      process.stderr.write(`    ${answer} is not there. Again, or leave it blank:\n`);
    }
  } finally {
    rl.close();
  }
}

/** The images this build wrote, newest first. `release/` keeps earlier versions, so the run's own
 *  start time is what separates them. */
function imagesSince(dir: string, since: number): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.dmg'))
    .map((f) => ({ path: join(dir, f), at: statSync(join(dir, f)).mtimeMs }))
    .filter((f) => f.at >= since)
    .sort((a, b) => b.at - a.at)
    .map((f) => f.path);
}

/**
 * What to say when notarizing the image did not finish.
 *
 * It takes the phase and the exit status and NOTHING ELSE, which is the point. The submission's
 * argv carries the app-specific password, and `execFileSync` puts the whole command line into its
 * error message, so a message built from that error would print the credential to the terminal and
 * into whatever captured it. A function that never receives the cause cannot leak it.
 *
 * Nothing is lost by omitting it: notarytool's own output is inherited straight to the terminal, so
 * the reason is already on screen, above this line.
 */
export function notarizeFailure(image: string, phase: string, status: number | null): string {
  return (
    `${basename(image)} was built and signed, and \`${phase}\` did not finish` +
    `${status === null ? '' : ` (exit ${status})`}. Its own output is above.\n` +
    'The application inside the image is notarized; the image around it is not, so a Mac that downloads it will refuse it.'
  );
}

/**
 * Notarize and staple the disk image itself.
 *
 * The packager has already notarized and stapled the application inside it, which is what lets the
 * app launch. Gatekeeper judges a browser download on the file that was downloaded, which is this
 * one, so it is submitted in its own right.
 */
function notarizeImage(image: string, auth: readonly string[]): void {
  const run = (phase: string, argv: readonly string[]): void => {
    try {
      execFileSync('xcrun', [...argv], { stdio: 'inherit' });
    } catch (cause) {
      const status = (cause as { status?: unknown }).status;
      throw new Error(notarizeFailure(image, phase, typeof status === 'number' ? status : null));
    }
  };
  run('xcrun notarytool submit', ['notarytool', 'submit', image, ...auth, '--wait']);
  run('xcrun stapler staple', ['stapler', 'staple', image]);
}

/** One image, as the report names it. */
export interface ShippedImage {
  /** Relative to the project, which is where the reader is standing. */
  path: string;
  bytes: number;
}

/** Everything the report needs to say what was made. */
export interface Shipped {
  product: string;
  version: string;
  images: readonly ShippedImage[];
  signing: Signing;
  /** The icon as the manifest names it, or absent when the app wears Electron's. */
  icon?: string;
}

/** What was made, and what is true of it — including what it cannot do yet. */
export function report({ product, version, images, signing, icon }: Shipped): string {
  const made = images.map((i) => `  ${i.path}  (${Math.round(i.bytes / 1e6)} MB)`);
  const standing = signing.notarize
    ? [
        'Signed, notarized and stapled. Check it with `xcrun stapler validate` on the path above, then',
        'hand it over: a Mac that downloads it through a browser will open it.',
      ]
    : signing.sign
      ? [
          'Signed with your Developer ID and not notarized, so a Mac that downloads it through a browser',
          'will still refuse it. Set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER — or a stored',
          '`notarytool` profile as APPLE_KEYCHAIN_PROFILE — and run this again.',
        ]
      : [
          'Unsigned, which is enough to open it on this Mac and not enough for anyone else\'s. Set CSC_LINK',
          '(base64 of a Developer ID Application .p12) and CSC_KEY_PASSWORD to sign it, and APPLE_API_KEY,',
          'APPLE_API_KEY_ID and APPLE_API_ISSUER to notarize it as well.',
        ];
  // The icon is the one thing ship can complete without being asked, so it is the one thing a reader
  // can be surprised by. Say which file it came from, or that none was found and where to put one.
  const mark = icon === undefined
    ? ['No icon is set, so it wears Electron\'s. Put a .icns or a square .png of at least 512px at',
       '`build/icon.icns`, or name one under `ship.icon`.']
    : [`Icon: ${icon} — replace that file to change it, or point \`ship.icon\` at another.`];
  return [
    `${product} ${version}:`,
    ...made,
    '',
    ...mark,
    '',
    ...standing,
    '',
    'No weights are inside. The app acquires every model it is configured for on first launch, into its',
    'own writable folder, and nothing it writes goes near this project. Windows and Linux each need',
    'their own machine to build on; this ships macOS.',
  ].join('\n');
}

export const shipCommand: Command = {
  name: 'ship',
  summary: 'Package this harness as a macOS app you can hand to someone',
  usage: USAGE,
  async run(argv) {
    const { values } = parseArgs({
      args: [...argv],
      options: { help: { type: 'boolean', short: 'h' } },
      allowPositionals: false,
    });
    if (values.help) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    try {
      const root = harnessProjectRoot();
      if (process.platform !== 'darwin') {
        throw new Error(
          `a macOS application can only be built on macOS, and this is ${process.platform}.\n` +
            'The harness itself runs here — `npm start`, `npm run dev:desktop` — and Windows and Linux images are not built yet.',
        );
      }
      const pkg = readPackageJson(join(root, 'package.json'));
      const name = asText(pkg.name);
      const version = asText(pkg.version);
      if (name === undefined || version === undefined) throw new Error('package.json needs a `name` and a `version`; an application is named and numbered.');
      if (pkg.scripts?.['build:desktop'] === undefined) {
        throw new Error('this project has no desktop surface to package. `lloyal targets:add desktop` puts it back.');
      }

      const product = await productName(root);
      const yml = openHarnessYml(root);
      const declared: Declared = { id: asText(yml.get(['ship', 'id'])), icon: asText(yml.get(['ship', 'icon'])) };
      let appId = declared.id;
      let icon = declared.icon;
      if (appId === undefined || !validAppId(appId)) {
        if (!interactive(process.stderr)) {
          const why =
            appId === undefined
              ? `${HARNESS_YML} names no \`ship.id\``
              : `${HARNESS_YML} says \`ship.id: ${appId}\`, which no Mac will accept as an application identifier`;
          throw new Error(`${why}, and there is nobody to ask — stdin is not a terminal.\n\n${whatToAdd(slugOf(name))}`);
        }
        const asked = await askIdentity(root, product, slugOf(name), icon !== undefined, appId);
        yml.set(['ship', 'id'], asked.id);
        if (asked.icon !== undefined) yml.set(['ship', 'icon'], asked.icon);
        yml.save();
        process.stderr.write(`\nlloyal: wrote \`ship:\` to ${HARNESS_YML}.\n`);
        appId = asked.id;
        icon = asked.icon ?? icon;
      }
      const iconPath = icon === undefined ? undefined : resolve(root, icon);
      if (iconPath !== undefined) {
        const refused = iconRefusal(iconPath, icon as string);
        if (refused !== undefined) throw new Error(refused);
      }

      // Written where nothing keeps it: a packaging config in a developer's repository is the thing
      // this verb exists not to leave behind. Left for the operating system to reap rather than
      // removed here, because `release/builder-effective-config.yaml` already records what the
      // packager was told, so nothing is read back from these two files after the build.
      const work = mkdtempSync(join(tmpdir(), 'lloyal-ship-'));
      const entitlements = join(work, 'entitlements.plist');
      writeFileSync(entitlements, ENTITLEMENTS);
      const signing = signingFrom(process.env);
      const config = harnessPackaging({
        productName: product,
        appId,
        ...(iconPath !== undefined ? { icon: iconPath } : {}),
        entitlements,
        ...signing,
      });
      const configFile = join(work, 'electron-builder.json');
      writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
      // Credentials, if any, are read straight from the environment by the packager. Ask for them
      // here too, before a long build, so a missing issuer is a sentence rather than a rejection.
      const auth = signing.notarize ? notaryArgs(process.env) : [];

      process.stdout.write(`Building ${product}'s desktop surface.\n\n`);
      if ((await npmExit(['run', 'build:desktop'], root)) !== 0) {
        throw new Error('`npm run build:desktop` failed — the output above says why. Nothing was packaged.');
      }

      const startedAt = Date.now() - 1000;   // filesystem timestamps are coarser than this clock
      process.stdout.write(`\nPackaging with ${PACKAGER}, fetched on demand the first time.\n\n`);
      const packed = await npmExit(
        // `--publish never`: an artifact leaves this machine when somebody sends it, never as a side
        // effect of building it.
        ['exec', '--yes', '--package', PACKAGER, '--', 'electron-builder', '--mac', '--config', configFile, '--publish', 'never'],
        root,
      );
      if (packed !== 0) throw new Error('the packager failed — the output above says why.');

      const images = imagesSince(join(root, OUTPUT), startedAt);
      if (images.length === 0) throw new Error(`the packager reported success and left no disk image in ${OUTPUT}/.`);
      if (signing.notarize) {
        for (const image of images) {
          process.stdout.write(`\nNotarizing ${basename(image)}. This waits on Apple, which takes minutes.\n`);
          notarizeImage(image, auth);
        }
      }

      process.stdout.write(`\n${report({
        product,
        version,
        images: images.map((p) => ({ path: relative(root, p), bytes: statSync(p).size })),
        signing,
        ...(icon !== undefined ? { icon } : {}),
      })}\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`lloyal ship: ${asMessage(err)}\n`);
      return 1;
    }
  },
};
