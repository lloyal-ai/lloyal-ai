/**
 * What a harness has to tell a packager, and why none of it is the developer's to remember.
 *
 * Packaging an ordinary Electron app is a handful of obvious fields. Packaging one with a resident
 * model is not: the native runtime has to be unpacked from the archive or it cannot load, the engine
 * is the project's own compiled cli rather than a dependency so it has to be told to travel, the
 * prompts are read with plain `fs` at every render so they cannot live inside the archive either,
 * and the disk image needs notarizing in its own right or Gatekeeper rejects it on download. Each of
 * those is invisible until something fails a long way from its cause.
 *
 * So the machinery lives here and the project keeps only what is genuinely its own: its name, its
 * bundle identifier and its icon. A project that later needs more can take a copy and spread this
 * over it, which is the one place a change in the native runtime still reaches them.
 *
 * Proven against `reasoning.run.desktop`, which ships a signed, notarized dmg on this shape.
 */

/** The three hardened-runtime exemptions a harness needs, and nothing else.
 *
 *  JIT and unsigned executable memory are the model itself — V8 and the inference runtime both write
 *  and execute. Library validation goes off so the addon's sibling dylibs, which carry a different
 *  signature or none, can load at all. Without these an app notarizes and then dies on launch. */
export const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
`;

/** Whether this machine can sign, and whether it can also notarize. */
export interface Signing {
  sign: boolean;
  notarize: boolean;
}

/**
 * What a build will do about signing: the ASKING is the caller's, the secrets are the environment's.
 *
 * Intent cannot be inferred from the environment, and inferring it is how an artifact comes out
 * unsigned while everyone believes otherwise — a variable left over from another project is enough.
 * So nothing is signed unless it was asked for, and something asked for and not possible is refused
 * ({@link distributionRefusal}) rather than quietly downgraded.
 *
 * The two fields always agree today, because notarizing without signing is not a state that exists:
 * Apple's notary service only accepts a submission already signed with a Developer ID. They stay
 * two because they drive two different keys, and because Windows signs and never notarizes.
 */
export function signingFrom(env: NodeJS.ProcessEnv, asked: boolean): Signing {
  const able = asked && hasCertificate(env) && notaryRoute(env) !== null;
  return { sign: able, notarize: able };
}

/**
 * Is there a Developer ID to sign with?
 *
 * `||`, never `??`. A variable that is SET AND EMPTY is the ordinary shape of an absent CI secret —
 * `CSC_LINK: ${{ secrets.CSC_LINK }}` interpolates to `''` when the secret is not there — and `??`
 * treats that as a value, so an empty CSC_LINK would mask a perfectly good CSC_NAME. The packager
 * reads these the same way, and the two must agree.
 */
export const hasCertificate = (env: NodeJS.ProcessEnv): boolean => Boolean(env.CSC_LINK || env.CSC_NAME);

/** Could this machine produce a distributable artifact if it were asked to? */
export const canDistribute = (env: NodeJS.ProcessEnv): boolean => hasCertificate(env) && notaryRoute(env) !== null;

/**
 * Why a distributable build cannot happen here, said as the thing to paste, or nothing.
 *
 * The refusal IS the documentation. A scaffold gains no example file nobody opens, and the names
 * arrive at the one moment they are wanted. The routes that leave no secret in the file come first,
 * because the file is the reason to prefer them.
 */
export function distributionRefusal(env: NodeJS.ProcessEnv): string | undefined {
  const missing = [
    ...(hasCertificate(env) ? [] : ['a Developer ID certificate']),
    ...(notaryRoute(env) === null ? ['notary credentials'] : []),
  ];
  if (missing.length === 0) return undefined;
  return [
    `--notarize needs ${missing.join(' and ')}; this machine has ${missing.length > 1 ? 'neither' : 'none'}.`,
    '',
    'Put them in `.env.local`, which git already ignores. These two leave no secret in the file:',
    '',
    // The name is the certificate's own, WITHOUT the "Developer ID Application:" that Keychain
    // Access shows in front of it: the packager picks the kind of certificate itself and refuses a
    // name carrying that prefix. Everything here is one assignment per line, because this block is
    // meant to be pasted and a dotenv file reads the rest of the line as the value.
    '  CSC_NAME="Your Name (TEAMID)"   # your certificate, minus the "Developer ID Application:" part',
    '  APPLE_KEYCHAIN_PROFILE=<name>   # xcrun notarytool store-credentials <name>',
    '',
    'On CI, where there is no keychain to read:',
    '',
    '  CSC_LINK=<base64 of a Developer ID Application .p12>',
    '  CSC_KEY_PASSWORD=<its password>',
    '  APPLE_API_KEY=<path to AuthKey_XXXX.p8>',
    '  APPLE_API_KEY_ID=<id>',
    '  APPLE_API_ISSUER=<uuid>',
  ].join('\n');
}

/** The three ways Apple will accept a submission. */
export type NotaryRoute = 'apple-id' | 'api-key' | 'keychain-profile';

/**
 * Which credentials this machine has, in the packager's own order of preference.
 *
 * The order is copied from it deliberately, and this is the reason: the packager notarizes the
 * APPLICATION and this command notarizes the IMAGE around it, from the same environment. If the two
 * disagreed about which credentials to use, a machine holding both an Apple ID and an API key would
 * ship an application notarized under one account inside an image notarized under another — which
 * works, and is a thing nobody would ever think to look for when it does not.
 *
 * Preferring the safer route here would not make the release safer, because the packager has already
 * used the other one by the time this runs.
 */
export function notaryRoute(env: NodeJS.ProcessEnv): NotaryRoute | null {
  // `||` for the same reason as above, and to the same end: an empty APPLE_API_KEY beside a real key
  // id and issuer must still be read as "the API key route, incompletely configured" — which `need`
  // then names — rather than falling through to a different account's credentials.
  if (env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD) return 'apple-id';
  if (env.APPLE_API_KEY || env.APPLE_API_KEY_ID || env.APPLE_API_ISSUER) return 'api-key';
  if (env.APPLE_KEYCHAIN_PROFILE) return 'keychain-profile';
  return null;
}

/** What the project itself says about the application, plus where its entitlements were written. */
export interface PackagingInput extends Signing {
  /** The name a reader sees, from the project's own presentation. */
  productName: string;
  /** The bundle identifier, from the project's `ship:` block. */
  appId: string;
  /** An icon, absolute. Omitted, the packager uses Electron's — which is honest, and better than
   *  putting somebody else's mark on this app. */
  icon?: string;
  /** Where {@link ENTITLEMENTS} was written for this build. */
  entitlements: string;
}

/**
 * The packager's whole instruction, derived from what the project declares.
 *
 * Returned as data rather than written to disk: nothing about packaging needs to live in a
 * developer's repository for this to work.
 */
export function harnessPackaging(input: PackagingInput): Record<string, unknown> {
  return {
    appId: input.appId,
    productName: input.productName,
    directories: { output: 'release' },   // `dist/` is the engine's; an artifact must not land in it

    asar: true,
    // The addon and its sibling dylibs must be co-located on a real filesystem: a native library
    // cannot be opened from inside the archive, and `@loader_path` finds its siblings beside it.
    asarUnpack: ['**/node_modules/@lloyal-labs/lloyal.node*/**'],
    // The binaries are prebuilt; there is nothing here to compile.
    npmRebuild: false,
    // Refuse to finish unsigned once signing has been asked for. Without this the packager answers a
    // missing or unusable certificate with a WARNING and produces an unsigned app, and the report
    // would go on to call it signed on the strength of the environment alone — the worst outcome
    // available, since the developer would hand out something they believe Gatekeeper will accept.
    forceCodeSigning: input.sign,

    // `out/` is only the window. The engine is this project's own `bin/run.js`, which imports the
    // compiled cli from `dist/`, and the manifest travels as the application's default for a first
    // launch to copy out. The packager adds the production dependency tree itself.
    files: ['out/**', 'package.json', 'bin/**', 'dist/**', 'harness.yml'],
    // Beside the archive rather than inside it: Eta reads this folder with plain `fs` on every
    // render, resolved from the engine's working directory, which cannot be an archive path.
    extraResources: [{ from: 'src/harness/prompts', to: 'src/harness/prompts' }],

    mac: {
      target: ['dmg'],
      category: 'public.app-category.productivity',
      // Said explicitly, not left to the default. The identity search falls back to a *Mac
      // Developer* certificate — with only a warning — whenever this key is unset, and that is a
      // development certificate: it signs, and no other Mac will accept what it signed.
      type: 'distribution',
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      // `null` forces an unsigned build; `undefined` lets the packager discover a Developer ID.
      identity: input.sign ? undefined : null,
      hardenedRuntime: input.sign,
      entitlements: input.entitlements,
      entitlementsInherit: input.entitlements,
      gatekeeperAssess: false,
      notarize: input.notarize,
    },

    dmg: {
      contents: [
        { x: 165, y: 205 },
        { x: 495, y: 205, type: 'link', path: '/Applications' },
      ],
    },
  };
}

/**
 * What `xcrun notarytool` authenticates a submission with, read from the same variables
 * electron-builder reads to notarize the application inside the image.
 *
 * The disk image is submitted separately, by {@link ../commands/ship}, after the packager has
 * finished: the packager notarizes and staples the app, which is what lets it launch, and leaves the
 * image around it unstapled, which is what a browser download is judged on.
 *
 * A missing variable is named here rather than passed through empty. Notarytool's own answer to an
 * empty issuer is a generic authentication failure, and it arrives at the end of a long build.
 */
export function notaryArgs(env: NodeJS.ProcessEnv): string[] {
  const need = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set, and notarizing needs it.`);
    return value;
  };
  switch (notaryRoute(env)) {
    case 'api-key':
      return ['--key', need('APPLE_API_KEY'), '--key-id', need('APPLE_API_KEY_ID'), '--issuer', need('APPLE_API_ISSUER')];
    // A stored profile keeps the secret in the keychain, where a command line cannot expose it.
    case 'keychain-profile':
      return ['--keychain-profile', need('APPLE_KEYCHAIN_PROFILE'),
        ...(env.APPLE_KEYCHAIN ? ['--keychain', env.APPLE_KEYCHAIN] : [])];
    // The password becomes an argument to `notarytool`, and an argument is readable by anything
    // running as this user for as long as the submission takes. The packager does the same with it
    // when notarizing the application, so this is the environment's exposure rather than this
    // command's, and the way out of it is a key or a stored profile instead.
    default:
      return ['--apple-id', need('APPLE_ID'), '--password', need('APPLE_APP_SPECIFIC_PASSWORD'), '--team-id', need('APPLE_TEAM_ID')];
  }
}
