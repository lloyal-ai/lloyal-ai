/**
 * Tests for the dep-free tarball reader used by publish (post-pack assert) +
 * install (attention-surface display). Builds a gzipped ustar tarball with
 * node:zlib + a manual header writer, matching the worker's tarball-inspect test.
 */
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { readTarEntry } from '../src/tar-read';
import { buildTarball } from './helpers/tarball';

describe('readTarEntry', () => {
  it('reads a present entry by full path', async () => {
    const tgz = buildTarball([
      { name: 'package/package.json', content: '{"name":"x"}' },
      { name: 'package/attention-surface.json', content: '{"skill":"hi"}' },
    ]);
    expect(await readTarEntry(tgz, 'package/attention-surface.json')).toBe('{"skill":"hi"}');
  });

  it('returns null for an absent entry', async () => {
    const tgz = buildTarball([{ name: 'package/package.json', content: '{}' }]);
    expect(await readTarEntry(tgz, 'package/attention-surface.json')).toBeNull();
  });

  it('returns null on non-gzip / corrupt input (never throws)', async () => {
    expect(await readTarEntry(new Uint8Array([1, 2, 3, 4]), 'package/x')).toBeNull();
  });

  it('caps a zip bomb instead of OOMing', async () => {
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(65 * 1024 * 1024, 0)));
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    // The 64 MiB maxOutputLength makes gunzip throw → readTarEntry returns null.
    expect(await readTarEntry(bomb, 'package/x')).toBeNull();
  });
});
