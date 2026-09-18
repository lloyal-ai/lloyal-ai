/**
 * The RunPod story, as a test: `new -y` on a box that reports an NVIDIA GPU runs on it with no file edited.
 * nvidia-smi is a fake runner, the project's lloyal.node is a fake planted by a fake `npm install`, and the
 * pack "download" is a recorded call — so the whole path from detection to `gpu: cuda` runs on this Mac.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { B200, NVIDIA_SMI_NAMES } from './backend-pack-fixtures.js';

let gpuOnBox: string | null = 'NVIDIA B200';
const probe = B200;

vi.mock('../src/scaffold/backend-pack.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/scaffold/backend-pack.js')>();
  return { ...actual, detectNvidiaGpu: () => gpuOnBox };
});
vi.mock('../src/scaffold/post-scaffold.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/scaffold/post-scaffold.js')>();
  // A fake `npm install`: plants the project's lloyal.node, whose probe says B200 and whose ensure records.
  const runInstall = async (dest: string): Promise<boolean> => {
    const pkg = join(dest, 'node_modules', '@lloyal-labs', 'lloyal.node');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@lloyal-labs/lloyal.node', version: '9.9.9', main: 'index.js' }));
    writeFileSync(join(pkg, 'index.js'), `
      const fs = require('node:fs');
      exports.probeBackendPack = async () => (${JSON.stringify(probe)});
      exports.ensureBackendPack = async (opts) => { fs.writeFileSync(${JSON.stringify(join(dest, 'ensure-called.json'))}, JSON.stringify(opts)); return '/cache/9.9.9-linux-x64'; };
    `);
    return true;
  };
  return { ...actual, runInstall };
});

const { newCommand } = await import('../src/commands/new.js');
const { detectNvidiaGpu, packPlatform } = await vi.importActual<typeof import('../src/scaffold/backend-pack.js')>('../src/scaffold/backend-pack.js');
const { initialQueue } = await import('../src/commands/new-wizard.js');

const created: string[] = [];
let out = '';
beforeEach(() => {
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out += String(c); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });   // a terminal: install runs
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function scaffold(extra: string[]): Promise<{ yml: string; ensured: boolean; code: number }> {
  const parent = mkdtempSync(join(tmpdir(), 'new-backend-'));
  created.push(parent);
  const code = await newCommand.run(['pod', '--dir', parent, '--targets', 'cli', '--template', 'basic', '-y', '--skip-abilities', ...extra]);
  const dest = join(parent, 'pod');
  return { code, yml: readFileSync(join(dest, 'harness.yml'), 'utf8'), ensured: existsSync(join(dest, 'ensure-called.json')) };
}

describe('detectNvidiaGpu — the box, through a fake nvidia-smi', () => {
  it('reads the first GPU name; none when nvidia-smi is absent or empty; never asks off linux-x64', () => {
    expect(detectNvidiaGpu(() => ({ status: 0, stdout: NVIDIA_SMI_NAMES }))).toBe('NVIDIA B200');
    expect(detectNvidiaGpu(() => ({ status: 127, stdout: '' }))).toBeNull();
    expect(detectNvidiaGpu(() => ({ status: 0, stdout: '\n' }))).toBeNull();
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    let asked = false;
    expect(detectNvidiaGpu(() => { asked = true; return { status: 0, stdout: 'x' }; })).toBeNull();
    expect(asked).toBe(false);
    expect(packPlatform()).toBe(false);
  });
});

describe('the wizard — the backend question exists only for a box with a GPU', () => {
  it('asks when a GPU is reported and nothing settled it; not otherwise', () => {
    expect(initialQueue({ nvidiaGpu: 'NVIDIA B200' })).toContain('backend');
    expect(initialQueue({ nvidiaGpu: 'NVIDIA B200', backend: 'gpu' })).not.toContain('backend');
    expect(initialQueue({ nvidiaGpu: null })).not.toContain('backend');
    expect(initialQueue({})).not.toContain('backend');
    expect(initialQueue({ nvidiaGpu: 'NVIDIA B200' })).toEqual(['name', 'targets', 'model', 'backend', 'template']);
  });
});

describe('new -y on a box with a B200', () => {
  it('runs on the GPU with no file edited: pack fetched after install, harness.yml says gpu: cuda, the panel says so', async () => {
    gpuOnBox = 'NVIDIA B200';
    const r = await scaffold([]);
    expect(r.code).toBe(0);
    expect(r.ensured).toBe(true);
    expect(r.yml).toMatch(/^    gpu: cuda$/m);
    expect(r.yml).not.toMatch(/# gpu: cuda/);
    expect(out).toContain('GPU: CUDA backend pack installed → /cache/9.9.9-linux-x64');
  });
  it('--backend-pack skip: CPU, nothing fetched, nothing written, nothing said', async () => {
    gpuOnBox = 'NVIDIA B200';
    const r = await scaffold(['--backend-pack', 'skip']);
    expect(r.code).toBe(0);
    expect(r.ensured).toBe(false);
    expect(r.yml).toMatch(/# gpu: cuda/);
    expect(out).not.toContain('GPU:');
  });
  it('a box with no GPU: the question never arises', async () => {
    gpuOnBox = null;
    const r = await scaffold([]);
    expect(r.ensured).toBe(false);
    expect(r.yml).toMatch(/# gpu: cuda/);
    expect(out).not.toMatch(/GPU:|CPU for now/);
  });
});
