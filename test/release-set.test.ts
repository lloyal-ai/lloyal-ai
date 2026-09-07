/**
 * The release driver's pure core. The script is I/O around it: reading
 * manifests off the remote, dispatching, watching.
 */
import { describe, it, expect } from 'vitest';
import { TARGETS, distTag, wouldMoveLatest, parseTargets } from '../scripts/release-set.lib.mjs';

describe('TARGETS', () => {
  it('puts hdk before the CLI — the templates pin packages that must exist first', () => {
    // Reversed, a scaffold from the published CLI would resolve versions the
    // registry does not have yet. The order is the table's, not the operator's.
    expect(TARGETS.map((t: { repo: string }) => t.repo))
      .toEqual(['lloyal-ai/hdk', 'lloyal-ai/lloyal-ai']);
  });

  it('names a manifest for every target, so the pre-flight has something to read', () => {
    for (const t of TARGETS as { manifests: string[]; branch: string }[]) {
      expect(t.manifests.length).toBeGreaterThan(0);
      expect(t.branch).toBeTruthy();
    }
  });
});

describe('distTag', () => {
  it('is the workflows own case statement: no prerelease suffix means latest', () => {
    expect(distTag('0.2.0-alpha.4')).toBe('alpha');
    expect(distTag('1.0.0-beta.1')).toBe('beta');
    expect(distTag('1.0.0-rc.2')).toBe('rc');
    expect(distTag('1.11.0')).toBe('latest');
  });
});

describe('wouldMoveLatest', () => {
  it('names the manifest that would move production, and stays quiet otherwise', () => {
    const entries = [
      { path: 'packages/sdk/package.json', version: '4.0.0-alpha.4' },
      { path: 'package.json', version: '1.11.0' },
    ];
    expect(wouldMoveLatest(entries)).toEqual([{ path: 'package.json', version: '1.11.0' }]);
    expect(wouldMoveLatest([entries[0]])).toEqual([]);
  });
});

describe('parseTargets', () => {
  const defaults = [{ repo: 'lloyal-ai/hdk', branch: 'feat/mtmd', manifests: ['a/package.json'] }];

  it('defaults to the table — naming nothing releases the standard set in order', () => {
    expect(parseTargets([], defaults)).toEqual(defaults);
  });

  it('an override keeps the target\'s manifests and only changes the branch', () => {
    expect(parseTargets(['--target', 'lloyal-ai/hdk:other'], defaults))
      .toEqual([{ repo: 'lloyal-ai/hdk', branch: 'other', manifests: ['a/package.json'] }]);
  });

  it('refuses a malformed spec and an unknown repo rather than ignoring them', () => {
    expect(() => parseTargets(['--target', 'nonsense'], defaults)).toThrow(/expected <owner>\/<repo>:<branch>/);
    expect(() => parseTargets(['--target', 'lloyal-ai/other:main'], defaults)).toThrow(/not a release target/);
  });

  it('takes a slashed branch whole, and refuses a second colon', () => {
    // git refnames cannot contain a colon, so `a:b` is a malformed spec rather
    // than a branch — accepting it would dispatch against a ref that cannot exist.
    expect(parseTargets(['--target', 'lloyal-ai/hdk:feat/research-identity'], defaults)[0].branch)
      .toBe('feat/research-identity');
    expect(() => parseTargets(['--target', 'lloyal-ai/hdk:feat/a:b'], defaults))
      .toThrow(/expected <owner>\/<repo>:<branch>/);
  });
});
