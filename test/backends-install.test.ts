/**
 * `backends:install` fetches the CUDA backend pack through the PROJECT's lloyal.node — resolved from the
 * project's node_modules, never carried by this CLI — and fetches nothing without a yes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backendsInstallCommand } from '../src/commands/backends.js';
import { describeOffer, projectPackHost, provisionCuda, snapshotPack, writeGpuField, cudaIsServed } from '../src/scaffold/backend-pack.js';
import { B200, H100_OLD_DRIVER, L4 } from './backend-pack-fixtures.js';

/** The template's model block, hint line included — what the gpu writer meets in a fresh scaffold. */
const YML = [
  'version: 1',
  'model:',
  '  llm:',
  '    id: "qwen3.5-4b"          # add `kvCache:` or `gpu:` below to override',
  '    context: 32768',
  '    # gpu: cuda              # backend (default · cuda · vulkan); boot fails if unavailable',
  '  # reranker:',
  '  #   id: "qwen3-reranker-0.6b"',
  'sources:',
  '  outputDir: reports',
  '',
].join('\n');

/** A project whose lloyal.node is a fake that records what the CLI asked of it. */
function project(probe: Record<string, unknown>, withAddon = true): { root: string; log: string } {
  const root = mkdtempSync(join(tmpdir(), 'backends-'));
  writeFileSync(join(root, 'harness.yml'), YML);
  writeFileSync(join(root, 'package.json'), '{"name":"p","version":"0.0.0"}');
  const log = join(root, 'calls.json');
  if (withAddon) {
    const pkg = join(root, 'node_modules', '@lloyal-labs', 'lloyal.node');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@lloyal-labs/lloyal.node', version: '9.9.9', main: 'index.js' }));
    writeFileSync(join(pkg, 'index.js'), `
      const fs = require('node:fs');
      let probes = 0;
      exports.probeBackendPack = async () => { fs.writeFileSync(${JSON.stringify(log + '.probes')}, String(++probes)); return (${JSON.stringify(probe)}); };
      exports.ensureBackendPack = async (opts) => {
        if (process.env.FAKE_PACK_FAIL) throw new Error('sha256 mismatch for backend-pack');
        fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(opts)); opts.onProgress?.(5, 10, 'backend-pack'); return '/cache/9.9.9-linux-x64';
      };
    `);
  }
  return { root, log };
}
const RECOMMENDED = B200;
const NOT = L4;

const cwd = process.cwd();
let out = '';
let err = '';
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); out = ''; err = ''; });
function capture(): void {
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out += String(s); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err += String(s); return true; });
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
}

describe('backends:install', () => {
  it('resolves the project\'s own lloyal.node, not one of this CLI\'s', async () => {
    const { root } = project(RECOMMENDED);
    const host = await projectPackHost(root);
    expect(host?.version).toBe('9.9.9');
    expect(await projectPackHost(project(RECOMMENDED, false).root)).toBeNull();
  });

  it('with --yes: says what the probe found, then fetches with the probe\'s own runtime decision', async () => {
    const { root, log } = project(RECOMMENDED);
    process.chdir(root); capture();
    expect(await backendsInstallCommand.run(['--yes'])).toBe(0);
    const { readFileSync } = await import('node:fs');
    expect(JSON.parse(readFileSync(log, 'utf8')).includeRuntime).toBe(true);
    expect(out).toContain('NVIDIA B200');
    expect(out).toContain('installed → /cache/9.9.9-linux-x64');
    expect(err).toContain('fetching backend-pack — 50%');
    expect(readFileSync(join(root, 'harness.yml'), 'utf8')).toMatch(/^    gpu: cuda$/m);   // the hint became the line
    expect(readFileSync(log + '.probes', 'utf8')).toBe('1');   // one snapshot: what was shown is what ran
  });

  it('a download that breaks is an error here — the operator asked for the pack and did not get it', async () => {
    const { root, log } = project(RECOMMENDED);
    process.chdir(root); capture();
    process.env.FAKE_PACK_FAIL = '1';
    try {
      expect(await backendsInstallCommand.run(['--yes'])).toBe(1);
    } finally { delete process.env.FAKE_PACK_FAIL; }
    const { existsSync } = await import('node:fs');
    expect(existsSync(log)).toBe(false);
    expect(err).toContain('the pack download failed — sha256 mismatch');
    expect(readFileSync(join(root, 'harness.yml'), 'utf8')).not.toMatch(/^    gpu: cuda$/m);
  });

  it('without --yes off a terminal: fetches nothing and says why', async () => {
    const { root, log } = project(RECOMMENDED);
    process.chdir(root); capture();
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    expect(await backendsInstallCommand.run([])).toBe(1);
    const { existsSync } = await import('node:fs');
    expect(existsSync(log)).toBe(false);
    expect(err).toContain('nothing is fetched without a yes');
  });

  it('a box the npm package already serves: nothing to install, exit 0, the reason said', async () => {
    const { root, log } = project(NOT);
    process.chdir(root); capture();
    expect(await backendsInstallCommand.run(['--yes'])).toBe(0);
    const { existsSync } = await import('node:fs');
    expect(existsSync(log)).toBe(false);
    expect(out).toContain('served natively by the standard npm package');
    expect(out).toContain('nothing to install');
    const { readFileSync: read } = await import('node:fs');
    expect(read(join(root, 'harness.yml'), 'utf8')).toMatch(/^    gpu: cuda$/m);   // true without the pack: npm serves it
  });

  it('gpu: cuda is written only when it is true — never for a box nothing serves', async () => {
    const unserved = H100_OLD_DRIVER;
    const { root, log } = project(unserved);
    const { readFileSync: read, existsSync } = await import('node:fs');
    const snap = await snapshotPack(root);
    if ('kind' in snap) throw new Error(snap.why);
    const outcome = await provisionCuda(root, snap, { fetch: true });
    expect(outcome.kind).toBe('cpu');
    expect(existsSync(log)).toBe(false);
    expect(read(join(root, 'harness.yml'), 'utf8')).not.toMatch(/^    gpu: cuda$/m);
    expect(cudaIsServed(unserved, true)).toBe(true);     // …but once the pack is there, it is
    expect(cudaIsServed(unserved, false)).toBe(false);
  });

  it('the gpu writer: rewrites a live line, promotes the hint, or inserts after the model id', () => {
    const { readFileSync: read, writeFileSync: write } = require('node:fs') as typeof import('node:fs');
    const { root } = project(RECOMMENDED);
    const yml = join(root, 'harness.yml');
    writeGpuField(root, 'cuda');
    expect(read(yml, 'utf8')).toMatch(/^    gpu: cuda$/m);
    expect(read(yml, 'utf8')).not.toMatch(/# gpu: cuda/);
    writeGpuField(root, 'cuda');                                  // idempotent on the live line
    expect(read(yml, 'utf8').match(/^    gpu: cuda$/mg)).toHaveLength(1);
    write(yml, 'version: 1\nmodel:\n  llm:\n    id: "x"\n    context: 1\nsources:\n  outputDir: r\n');
    writeGpuField(root, 'cuda');                                  // no hint: inserted after id
    expect(read(yml, 'utf8')).toBe('version: 1\nmodel:\n  llm:\n    id: "x"\n    gpu: cuda\n    context: 1\nsources:\n  outputDir: r\n');
  });

  it('a project without the addon says to install first', async () => {
    const { root } = project(RECOMMENDED, false);
    process.chdir(root); capture();
    expect(await backendsInstallCommand.run(['--yes'])).toBe(1);
    expect(err).toContain('run `npm install` first');
  });

  it('the offer names the download, runtime included only when the box needs it', () => {
    expect(describeOffer(RECOMMENDED).join('\n')).toContain('backend pack 0.8 GB + CUDA runtime 0.3 GB');
    // The same B200 with cudart 12.9 already on disk: no runtime gate line, no runtime in the download.
    const runtimeFine = { ...B200, needsRuntimeArchive: false, runtimeSizeBytes: 0, reasons: [B200.reasons[1]] };
    expect(describeOffer(runtimeFine).join('\n')).toContain('download: backend pack 0.8 GB, once per box');
    expect(describeOffer(runtimeFine).join('\n')).not.toContain('+ CUDA runtime');
  });
});
