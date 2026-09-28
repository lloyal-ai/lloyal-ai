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
 * Read the environment rather than a flag, so one config builds an unsigned disk image on a machine
 * with no Apple account and a notarized one on a machine with credentials, unchanged.
 *
 * Notarizing without signing is not a state that exists: there would be nothing to staple.
 */
export function signingFrom(env: NodeJS.ProcessEnv): Signing {
  const sign = Boolean(env.CSC_LINK ?? env.CSC_NAME);
  const notary = Boolean(env.APPLE_API_KEY ?? (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD));
  return { sign, notarize: sign && notary };
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
  return env.APPLE_API_KEY
    ? ['--key', need('APPLE_API_KEY'), '--key-id', need('APPLE_API_KEY_ID'), '--issuer', need('APPLE_API_ISSUER')]
    : ['--apple-id', need('APPLE_ID'), '--password', need('APPLE_APP_SPECIFIC_PASSWORD'), '--team-id', need('APPLE_TEAM_ID')];
}
