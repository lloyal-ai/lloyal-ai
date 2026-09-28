/**
 * The packaging config a harness needs, and why each part of it is not the developer's to remember.
 * Every row here is a thing that is silently wrong otherwise: an addon that cannot load, an engine
 * that is not in the bundle, prompts Eta cannot read, a disk image Gatekeeper rejects.
 */
import { describe, it, expect } from 'vitest';
import { harnessPackaging, signingFrom, ENTITLEMENTS } from '../src/scaffold/ship-config';

const identity = { productName: 'Fieldnote', appId: 'com.acme.fieldnote', entitlements: '/tmp/e.plist' };
const unsigned = { sign: false, notarize: false };

describe('harnessPackaging', () => {
  it('unpacks the native runtime, because a .node and its dylibs must sit together on disk', () => {
    const c = harnessPackaging({ ...identity, ...unsigned });
    expect(c.asar).toBe(true);
    expect(c.asarUnpack).toContain('**/node_modules/@lloyal-labs/lloyal.node*/**');
  });

  it('rebuilds nothing: the binaries are prebuilt', () => {
    expect(harnessPackaging({ ...identity, ...unsigned }).npmRebuild).toBe(false);
  });

  it('carries the engine and the compiled cli, not just the window', () => {
    // The desktop shell forks the project's own `bin/run.js`, which imports the built cli from
    // `dist/`. A bundle with only `out/` opens a window onto an engine that was never shipped.
    const files = harnessPackaging({ ...identity, ...unsigned }).files as string[];
    for (const needed of ['out/**', 'package.json', 'bin/**', 'dist/**', 'harness.yml']) {
      expect(files).toContain(needed);
    }
  });

  it('puts the prompts beside the archive, where a working directory can reach them', () => {
    // Eta reads the folder with plain fs at every render, and the templates resolve it from the
    // engine's working directory — which cannot be a path inside the archive.
    const extra = harnessPackaging({ ...identity, ...unsigned }).extraResources as { from: string; to: string }[];
    expect(extra).toContainEqual({ from: 'src/harness/prompts', to: 'src/harness/prompts' });
  });

  it('writes its artifact to release/, leaving dist/ to the engine', () => {
    expect(harnessPackaging({ ...identity, ...unsigned }).directories).toEqual({ output: 'release' });
  });

  it('builds unsigned when there are no credentials, so a first dmg needs no Apple account', () => {
    const mac = harnessPackaging({ ...identity, ...unsigned }).mac as Record<string, unknown>;
    expect(mac.identity).toBeNull();
    expect(mac.hardenedRuntime).toBe(false);
    expect(mac.notarize).toBe(false);
  });

  it('signs when a certificate is present, and notarizes only when the notary is too', () => {
    const signed = harnessPackaging({ ...identity, sign: true, notarize: false }).mac as Record<string, unknown>;
    expect(signed.identity).toBeUndefined();   // undefined lets electron-builder discover the cert
    expect(signed.hardenedRuntime).toBe(true);
    expect(signed.notarize).toBe(false);
    const both = harnessPackaging({ ...identity, sign: true, notarize: true }).mac as Record<string, unknown>;
    expect(both.notarize).toBe(true);
  });

  it('takes its name and identifier from the project, and leaves the icon out when there is none', () => {
    const c = harnessPackaging({ ...identity, ...unsigned });
    expect(c.productName).toBe('Fieldnote');
    expect(c.appId).toBe('com.acme.fieldnote');
    expect((c.mac as Record<string, unknown>).icon).toBeUndefined();
    const withIcon = harnessPackaging({ ...identity, ...unsigned, icon: '/p/build/icon.png' });
    expect((withIcon.mac as Record<string, unknown>).icon).toBe('/p/build/icon.png');
  });
});

describe('the entitlements', () => {
  it('ask for exactly what a model and a native addon need under the hardened runtime', () => {
    for (const key of [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
      'com.apple.security.cs.disable-library-validation',
    ]) expect(ENTITLEMENTS).toContain(key);
  });
});

describe('signingFrom', () => {
  it('reads the environment, so the same config builds signed or not with no edit', () => {
    expect(signingFrom({})).toEqual({ sign: false, notarize: false });
    expect(signingFrom({ CSC_LINK: 'x' })).toEqual({ sign: true, notarize: false });
    expect(signingFrom({ CSC_NAME: 'Developer ID' })).toEqual({ sign: true, notarize: false });
    expect(signingFrom({ CSC_LINK: 'x', APPLE_API_KEY: '/k.p8' })).toEqual({ sign: true, notarize: true });
    expect(signingFrom({ CSC_LINK: 'x', APPLE_ID: 'a@b', APPLE_APP_SPECIFIC_PASSWORD: 'p' })).toEqual({ sign: true, notarize: true });
  });

  it('never notarizes without signing — there would be nothing to staple', () => {
    expect(signingFrom({ APPLE_API_KEY: '/k.p8' })).toEqual({ sign: false, notarize: false });
  });
});

/**
 * Asking for a signature and getting an unsigned application is the worst outcome available: the
 * developer hands out something they believe Gatekeeper will accept, and every recipient is refused.
 * The packager's defaults allow it twice over — a missing certificate is a warning, and an unset
 * `type` quietly falls back to a *development* certificate — so both are closed here.
 */
describe('a requested signature is mandatory, and it is a distribution one', () => {
  it('forces code signing exactly when signing was asked for', () => {
    expect(harnessPackaging({ ...identity, sign: true, notarize: false }).forceCodeSigning).toBe(true);
    expect(harnessPackaging({ ...identity, sign: true, notarize: true }).forceCodeSigning).toBe(true);
    expect(harnessPackaging({ ...identity, ...unsigned }).forceCodeSigning).toBe(false);
  });

  /** Unset, the identity search falls back to `Mac Developer` with only a warning. That certificate
   *  signs, and no other Mac accepts what it signed. */
  it('never leaves the certificate type to the default', () => {
    for (const signing of [unsigned, { sign: true, notarize: false }, { sign: true, notarize: true }]) {
      const mac = harnessPackaging({ ...identity, ...signing }).mac as Record<string, unknown>;
      expect(mac.type).toBe('distribution');
    }
  });

  /** The two can never contradict: an unsigned build sets `identity: null`, and the packager refuses
   *  a null identity outright when signing is forced. */
  it('never forces signing and disables the identity at the same time', () => {
    const c = harnessPackaging({ ...identity, ...unsigned });
    expect(c.forceCodeSigning).toBe(false);
    expect((c.mac as Record<string, unknown>).identity).toBeNull();
  });
});
