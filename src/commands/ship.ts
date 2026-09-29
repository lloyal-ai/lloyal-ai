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
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Command } from '../command.js';
import { Interrupted, createRun, runNpmStep, runStep, type Running, type StepResult } from '../npm-spawn.js';
import { HARNESS_YML, openHarnessYml } from '../scaffold/harness-yml.js';
import { readPackageJson } from '../scaffold/package-json.js';
import { harnessProjectRoot } from '../scaffold/project.js';
import { ENTITLEMENTS, PROFILE, canDistribute, configuredIdentity, developerIdentities, distributionRefusal, harnessPackaging, notaryCredentials, notaryRoute, signingFrom, type DeveloperIdentity, type Signing } from '../scaffold/ship-config.js';
import { showSteps } from '../scaffold/steps.js';
import { interactive } from '../scaffold/terminal.js';

const USAGE = [
  'lloyal ship — build a distributable macOS application from this harness',
  '',
  'Usage:',
  '  lloyal ship [--notarize]',
  '',
  'Builds the desktop surface and packages it as a disk image in release/. The first run asks for an',
  'application identifier and, if you have one, an icon, and records both in harness.yml; later runs',
  'and CI read them from there.',
  '',
  'Model weights are not bundled. On first launch the installed application provisions every model',
  'named in harness.yml, digest-verified, into its own support directory.',
  '',
  'Without --notarize the image is unsigned: fast, and openable only on the machine that built it.',
  '',
  '--notarize produces the distributable artifact — signed with your Developer ID under the hardened',
  'runtime, notarized and stapled, so a Mac that downloads it accepts it. Nothing is signed unless it',
  'is asked for, and a request that cannot be met is refused before the build rather than quietly',
  'downgraded. Credentials are read from the environment and from `.env.local` in the project, which',
  'git ignores; a real environment variable wins, so CI needs no file:',
  '',
  '  CSC_LINK + CSC_KEY_PASSWORD   base64 of a Developer ID Application .p12, and its password',
  '  APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER   an App Store Connect key, to notarize',
  '  APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID   the same thing with an Apple ID',
  '  APPLE_KEYCHAIN_PROFILE        a stored `notarytool` profile, which keeps the secret in the keychain',
  '',
  'An unsigned image is refused by Gatekeeper on every machine but the one that built it.',
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
 * The environments the two credential-bearing children get, neither of them inherited whole.
 *
 * `debug` decides what to print from `DEBUG` at import time, and `@electron/notarize` — which the
 * packager uses for the application and which this command uses for the image — catches a failed
 * log fetch and logs the RAW error. That error carries `spawnargs`, and on the Apple-ID route the
 * argv holds the app-specific password. Removing the namespace is what makes that unreachable.
 */
const withoutDebug = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { DEBUG: _debug, NODE_DEBUG: _nodeDebug, ...rest } = env;
  return rest;
};

/** The notarize adapter is handed its credentials on stdin, so it inherits none of them. */
const withoutCredentials = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(withoutDebug(env)).filter(([name]) => !/^(APPLE_|CSC_)/.test(name)));

/**
 * Set up a notary credential without leaving the command.
 *
 * Apple has no API that mints an app-specific password, so a browser is unavoidable — but a second
 * run of `ship` is not. The credential is created, written down, and the build carries on, all in
 * the one invocation.
 *
 * **The password never enters this process.** `notarytool` puts up its own secure prompt when it is
 * given an Apple ID and a team and no `--password`, so the terminal is handed to it and the paste
 * goes keyboard → notarytool → keychain. Passing the password as an argument instead would put it
 * where `ps` can read it, and reading it into a masked field of ours would put it one careless
 * formatter away from a log. `--validate` is on by default, so a wrong paste fails against Apple
 * in seconds rather than at the end of a build.
 */
async function offerNotaryProfile(root: string, identities: readonly DeveloperIdentity[]): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    process.stderr.write(
      'Notarizing needs a credential, and this machine has none.\n\n' +
      'Apple issues an app-specific password. `notarytool` keeps it in the keychain and this project\n' +
      'only ever names it, so no secret lands in a file. Setting one up takes a minute in a browser.\n\n',
    );
    if (!/^y?$/i.test((await rl.question('  set one up now? [Y/n] ')).trim())) {
      process.stderr.write('\n');
      return;
    }

    // Opened before anything is asked, because signing in and making the password is the slow part
    // and the questions below can be answered while that page loads. The generic account page is
    // deliberate: the section is behind a sign-in, so the steps are written out rather than linked.
    runStep('open', ['https://account.apple.com'], { cwd: root }).join().catch(() => undefined);
    process.stderr.write(
      '\nOpening account.apple.com. Once signed in:\n\n' +
      '  1.  Sign-In and Security\n' +
      '  2.  App-Specific Passwords\n' +
      '  3.  Generate an app-specific password, name it `notarytool`, and copy it\n\n',
    );

    const appleId = (await rl.question('  your Apple ID: ')).trim();
    if (appleId === '') return;
    // The team belongs to the certificate the build will use. When that is not knowable — two
    // installed and nothing choosing between them, or a `.p12` the packager will import into a
    // keychain of its own — it is asked for rather than guessed.
    const known = configuredIdentity(process.env, identities)?.teamId;
    const teamId = known ?? (await rl.question('  your Team ID (developer.apple.com/account, top right): ')).trim();
    if (teamId === '') return;
    rl.close();

    process.stderr.write('\nPaste the password below. It is not echoed, and it goes to the keychain.\n\n');
    const stored = await runStep(
      'xcrun',
      ['notarytool', 'store-credentials', PROFILE, '--apple-id', appleId, '--team-id', teamId],
      { cwd: root, stdin: 'terminal' },
    ).join();
    if (stored.code !== 0) {
      process.stderr.write('\nApple did not accept that credential, so nothing was stored.\n\n');
      return;
    }

    // Written down so the next run asks nothing, and read back into THIS run so the build goes
    // ahead. Appended, because the file already holds the certificate name.
    const file = join(root, '.env.local');
    const held = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const line = `APPLE_KEYCHAIN_PROFILE=${PROFILE}\n`;
    writeFileSync(file, held === '' || held.endsWith('\n') ? `${held}${line}` : `${held}\n${line}`, { mode: 0o600 });
    // The profile only. The Apple ID must NOT reach the environment: `notaryRoute` would then pick
    // the Apple-ID route over the profile just stored, and ask for a password all over again.
    process.env.APPLE_KEYCHAIN_PROFILE = PROFILE;
    process.stderr.write(`\nStored as \`${PROFILE}\`, and named in .env.local.\n\n`);
  } finally {
    rl.close();
  }
}

/**
 * The packager's `key=value` tail, split without assuming values are one word.
 *
 * `identity=Zuhair Naqvi (GXB6ZZPDWJ)` has spaces in it, so splitting on whitespace loses most of
 * the name. The keys are the only reliable boundary, so the slices between them are the values.
 */
function fields(rest: string): Record<string, string> {
  const marks: Array<{ key: string; from: number; to: number }> = [];
  const re = /(\w+)=/g;
  for (let m = re.exec(rest); m !== null; m = re.exec(rest)) marks.push({ key: m[1], from: m.index, to: re.lastIndex });
  const out: Record<string, string> = {};
  marks.forEach((mark, i) => {
    out[mark.key] = rest.slice(mark.to, i + 1 < marks.length ? marks[i + 1].from : rest.length).trim();
  });
  return out;
}

/**
 * One line of the packager's log as a phase of the work, or nothing when it is not one.
 *
 * Reading a vendor's log is usually a way to be wrong quietly, and this is the case where it is
 * not: `PACKAGER` is pinned to an exact version, never a range, so the format is pinned exactly as
 * tightly as the packager. A version bump is a deliberate act, and this is part of what it has to
 * re-check.
 *
 * It is additive by construction. An unrecognised line adds nothing, so a format that moves loses
 * DETAIL and never truth — whether the step succeeded is the exit code's answer, not this one's.
 */
export function packagerPhase(line: string): { label: string; detail?: string } | undefined {
  const bullet = /^\s*•\s+(.*)$/.exec(line);
  if (bullet === null) return undefined;
  const rest = bullet[1];
  const at = rest.search(/\s\w+=/);
  const marker = (at === -1 ? rest : rest.slice(0, at)).trim();
  const f = fields(at === -1 ? '' : rest.slice(at));

  if (marker === 'packaging') {
    return { label: 'packaged', detail: [f.platform, f.arch].filter(Boolean).join(' ') + (f.electron ? ` · electron ${f.electron}` : '') };
  }
  if (marker === 'signing') return { label: 'signed', ...(f.identity ? { detail: f.identity } : {}) };
  if (marker === 'building' && f.target !== undefined) return { label: 'built the disk image' };
  return undefined;
}

/** Where the adapter compiled to, found from this module rather than from the working directory. */
const ADAPTER = fileURLToPath(new URL('../notarize-image.js', import.meta.url));

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
  /** Whether this machine could have produced a distributable artifact. An unsigned build on a
   *  machine that is already set up is somebody forgetting the flag, not somebody without an
   *  Apple account, and the two want opposite advice. */
  ready?: boolean;
}

/** What was made, and what is true of it — including what it cannot do yet. */
export function report({ product, version, images, signing, icon, ready }: Shipped): string {
  const made = images.map((i) => `  ${i.path}  (${Math.round(i.bytes / 1e6)} MB)`);
  const standing = signing.notarize
    ? [
        'Signed, notarized and stapled. A Mac that downloads it through a browser will accept it.',
        'To see that for yourself, open the image and ask Gatekeeper about the app inside:',
        '  spctl -a -vvv -t exec /Volumes/<name>/<app>.app   → source=Notarized Developer ID',
        '`stapler validate` on the image is not that check: it falls back to asking Apple, so it',
        'passes whether or not the ticket ever reached the file.',
      ]
    : signing.sign
      ? [
          'Signed with your Developer ID and not notarized, so a Mac that downloads it through a browser',
          'will still refuse it. Set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER — or a stored',
          '`notarytool` profile as APPLE_KEYCHAIN_PROFILE — and run this again.',
        ]
      : ready === true
        ? [
            'Unsigned, which is enough to open it on this Mac and not enough for anyone else\'s — and this',
            'machine holds the credentials to change that. Run it again with `--notarize`.',
          ]
        : [
            'Unsigned, which is enough to open it on this Mac and not enough for anyone else\'s. A',
            'distributable build takes a Developer ID and notary credentials, and `--notarize` says what',
            'to put where.',
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
  summary: 'Build a distributable macOS application (.dmg)',
  usage: USAGE,
  async run(argv) {
    const { values } = parseArgs({
      args: [...argv],
      options: { help: { type: 'boolean', short: 'h' }, notarize: { type: 'boolean' } },
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
      // The project's own machine-local values, before anything reads the environment. A real
      // environment variable still wins, which is what a CI runner needs; the file is for a laptop.
      // `loadEnvFile` throws on a file that is not there, so the question is asked first.
      const localEnv = join(root, '.env.local');
      if (existsSync(localEnv)) process.loadEnvFile(localEnv);

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
      // Refused before the desktop build rather than after it: a missing variable is a sentence, and
      // finding it out at the end costs the whole build.
      if (values.notarize === true) {
        const identities = developerIdentities();
        // Offered only when there is nobody half-way through another route: a partly-configured
        // API key is a mistake to finish, not a reason to create a second credential beside it.
        if (interactive(process.stderr) && notaryRoute(process.env) === null) {
          await offerNotaryProfile(root, identities);
        }
        const refused = distributionRefusal(process.env, identities);
        if (refused !== undefined) throw new Error(refused);
      }
      const signing = signingFrom(process.env, values.notarize === true);
      const config = harnessPackaging({
        productName: product,
        appId,
        ...(iconPath !== undefined ? { icon: iconPath } : {}),
        entitlements,
        ...signing,
      });
      const configFile = join(work, 'electron-builder.json');
      writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
      // Credentials, if any, are read straight from the environment by the packager. Read here too
      // and BEFORE the long build, so a missing issuer is a sentence now rather than a rejection
      // at the end of it. The same object is what the adapter is handed later.
      const credentials = signing.notarize ? notaryCredentials(process.env) : undefined;

      // The wizard draws on stderr so that stdout carries the report and nothing else; a pipe has
      // no spinner to protect, so it gets the children's output as it arrives instead.
      const echo = !interactive(process.stderr);
      const labels = [
        `Building ${product}'s desktop surface`,
        signing.sign ? 'Packaging, signing and notarizing the application' : 'Packaging the application',
        ...(signing.notarize ? ['Notarizing and stapling the disk image — this waits on Apple'] : []),
      ];
      const view = showSteps(labels);
      const run = createRun();
      // The packager's own phases, and only those. Nothing is inferred from one marker about work
      // no marker mentions: what is on screen is what the packager said it did.
      const packagerProgress = (line: string): void => {
        const phase = packagerPhase(line);
        if (phase !== undefined) view.phase(1, phase);
      };
      // The child is created by the RUN, not by the caller: passing an already-spawned process
      // would start it before anything could check whether cancelling had begun.
      const step = async (index: number, start: () => Running): Promise<StepResult> => {
        view.start(index);
        const settled = await run.step(start);
        view.settle(index, settled.code === 0);
        return settled;
      };
      // A detached child is out of the terminal's foreground group, so Ctrl-C no longer reaches it
      // and stopping the tree is this command's job. 130 is what a shell reports for an interrupt.
      // SIGINT is Ctrl-C; SIGTERM is CI cancelling the job, `kill`, or the machine shutting down.
      // Both matter equally here: every child is DETACHED, so it is not in this terminal's process
      // group and the default handling — exit and leave — would orphan a build or a notarization.
      const stopOn = (code: number) => (): void => {
        void (async () => {
          await run.cancel();   // raises the gate synchronously, then waits for the tree to go
          view.stop();
          process.exit(code);
        })();
      };
      const onInterrupt = stopOn(130);
      const onTerminate = stopOn(143);
      process.once('SIGINT', onInterrupt);
      process.once('SIGTERM', onTerminate);

      let images: string[];
      try {
        const built = await step(0, () => runNpmStep(['run', 'build:desktop'], { cwd: root, env: withoutCredentials(process.env), echo }));
        if (built.code !== 0) throw new Error(`\`npm run build:desktop\` failed. Nothing was packaged.\n\n${built.output}`);

        const startedAt = Date.now() - 1000;   // filesystem timestamps are coarser than this clock
        const packed = await step(1, () => runNpmStep(
          // `--publish never`: an artifact leaves this machine when somebody sends it, never as a
          // side effect of building it.
          ['exec', '--yes', '--package', PACKAGER, '--', 'electron-builder', '--mac', '--config', configFile, '--publish', 'never'],
          { cwd: root, env: withoutDebug(process.env), echo, onLine: packagerProgress },
        ));
        if (packed.code !== 0) throw new Error(`the packager failed.\n\n${packed.output}`);

        images = imagesSince(join(root, OUTPUT), startedAt);
        if (images.length === 0) throw new Error(`the packager reported success and left no disk image in ${OUTPUT}/.`);

        if (signing.notarize) {
          for (const image of images) {
            const done = await step(2, () => runStep(process.execPath, [ADAPTER], {
              cwd: root,
              env: withoutCredentials(process.env),
              stdin: 'payload',
              payload: JSON.stringify({ appPath: image, ...credentials }),
              echo,
            }));
            // Output FIRST: the message says its output is above, and on a terminal the child was
            // never echoed, so the other order left that sentence pointing at nothing.
            if (done.code !== 0) throw new Error(`${done.output}\n${notarizeFailure(image, 'notarizing the disk image', done.code)}`);
          }
        }
      } finally {
        process.removeListener('SIGINT', onInterrupt);
        process.removeListener('SIGTERM', onTerminate);
        view.stop();
      }

      process.stdout.write(`\n${report({
        product,
        version,
        images: images.map((p) => ({ path: relative(root, p), bytes: statSync(p).size })),
        signing,
        ready: canDistribute(process.env, developerIdentities()),
        ...(icon !== undefined ? { icon } : {}),
      })}\n`);
      return 0;
    } catch (err) {
      // An interrupt already has its own exit path and its own code; it is not a failure to
      // narrate. The handler is normally what exits, and this is the backstop if it does not.
      if (err instanceof Interrupted) return 130;
      process.stderr.write(`lloyal ship: ${asMessage(err)}\n`);
      return 1;
    }
  },
};
