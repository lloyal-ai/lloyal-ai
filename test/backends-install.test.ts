/**
 * `backends:install` fetches the CUDA backend pack through the PROJECT's lloyal.node — resolved from the
 * project's node_modules, never carried by this CLI — and fetches nothing without a yes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backendsInstallCommand } from '../src/commands/backends.js';
import { describeOffer, projectPackHost } from '../src/scaffold/backend-pack.js';

/** A project whose lloyal.node is a fake that records what the CLI asked of it. */
function project(probe: Record<string, unknown>, withAddon = true): { root: string; log: string } {
  const root = mkdtempSync(join(tmpdir(), 'backends-'));
  writeFileSync(join(root, 'harness.yml'), 'version: 1\n');
  writeFileSync(join(root, 'package.json'), '{"name":"p","version":"0.0.0"}');
  const log = join(root, 'calls.json');
  if (withAddon) {
    const pkg = join(root, 'node_modules', '@lloyal-labs', 'lloyal.node');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@lloyal-labs/lloyal.node', version: '9.9.9', main: 'index.js' }));
    writeFileSync(join(pkg, 'index.js'), `
      const fs = require('node:fs');
      exports.probeBackendPack = async () => (${JSON.stringify(probe)});
      exports.ensureBackendPack = async (opts) => { fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(opts)); opts.onProgress?.(5, 10, 'backend-pack'); return '/cache/9.9.9-linux-x64'; };
    `);
  }
  return { root, log };
}
const RECOMMENDED = { gpu: { name: 'NVIDIA B200' }, recommended: true, needsRuntimeArchive: true, sizeBytes: 2.1e9, runtimeSizeBytes: 0.9e9, reasons: ['NVIDIA B200: pack provides native sm_100 kernels'] };
const NOT = { gpu: { name: 'NVIDIA L4' }, recommended: false, needsRuntimeArchive: false, sizeBytes: 2.1e9, runtimeSizeBytes: 0, reasons: ['GPU NVIDIA L4 (sm_89) is served natively by the standard npm package'] };

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
  });

  it('a project without the addon says to install first', async () => {
    const { root } = project(RECOMMENDED, false);
    process.chdir(root); capture();
    expect(await backendsInstallCommand.run(['--yes'])).toBe(1);
    expect(err).toContain('run `npm install` first');
  });

  it('the offer names the download, runtime included only when the box needs it', () => {
    expect(describeOffer(RECOMMENDED).join('\n')).toContain('backend pack 2.1 GB + CUDA runtime 0.9 GB');
    expect(describeOffer({ ...RECOMMENDED, needsRuntimeArchive: false }).join('\n')).not.toContain('CUDA runtime');
  });
});
