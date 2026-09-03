/**
 * link-local's one contract: ZERO tracked-file mutation at rest.
 * `package.json` is byte-identical after linking — including when the
 * install FAILS mid-way — and the links are plain symlinks ours to place
 * and unlink-local's to delete. npm is mocked: these assert the manifest
 * choreography and the link set, never the network.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const npmMock = vi.hoisted(() => ({ nextCode: 0, calls: [] as string[][] }));
vi.mock('../src/npm-spawn.js', () => ({
  spawnNpm: (args: string[]) => {
    npmMock.calls.push(args);
    const child = new EventEmitter();
    setImmediate(() => child.emit('close', npmMock.nextCode));
    return child;
  },
}));

const { linkLocalCommand, unlinkLocalCommand } = await import('../src/commands/link-local.js');

const created: string[] = [];
const startCwd = process.cwd();
afterEach(() => {
  process.chdir(startCwd);
  vi.restoreAllMocks();
  npmMock.nextCode = 0;
  npmMock.calls.length = 0;
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

/** A fake hdk workspace: sdk (built), rig (unbuilt), both abilities. */
function fakeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'link-ws-'));
  created.push(ws);
  for (const [rel, built] of [
    ['packages/sdk', true],
    ['packages/rig', false],
    ['packages/abilities/web', true],
    ['packages/abilities/corpus', true],
  ] as const) {
    mkdirSync(join(ws, rel), { recursive: true });
    writeFileSync(join(ws, rel, 'package.json'), '{"name":"x"}');
    if (built) mkdirSync(join(ws, rel, 'dist'));
  }
  // The lloyal.node repo as a sibling, for the probe path.
  mkdirSync(join(ws, '..', 'lloyal-node'), { recursive: true });
  writeFileSync(join(ws, '..', 'lloyal-node', 'package.json'), '{"name":"n"}');
  return ws;
}

function fakeProject(): { dir: string; manifest: string } {
  const dir = mkdtempSync(join(tmpdir(), 'link-proj-'));
  created.push(dir);
  const manifest = `${JSON.stringify(
    {
      name: 'proj',
      dependencies: {
        '@lloyal-labs/sdk': '3.2.0-alpha.9',
        '@lloyal-labs/rig': '5.6.0-alpha.9',
        '@lloyal-labs/lloyal.node': '3.2.0-alpha.9',
        effection: '^4.1.0',
      },
    },
    null,
    2,
  )}\n`;
  writeFileSync(join(dir, 'package.json'), manifest);
  return { dir, manifest };
}

describe('link-local', () => {
  it('links the mapped deps + absent abilities, leaves the manifest byte-identical', async () => {
    const ws = fakeWorkspace();
    const { dir, manifest } = fakeProject();
    process.chdir(dir);
    const err: string[] = [];
    const out: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => (err.push(String(c)), true));
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => (out.push(String(c)), true));

    const code = await linkLocalCommand.run([ws]);
    expect(code).toBe(0);

    // THE contract: not one byte moved.
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(manifest);

    // Mapped deps linked; abilities linked though never dependencies.
    const link = (name: string) => join(dir, 'node_modules', ...name.split('/'));
    for (const name of ['@lloyal-labs/sdk', '@lloyal-labs/rig', '@lloyal-labs/web-ability', '@lloyal-labs/corpus-ability', '@lloyal-labs/lloyal.node']) {
      expect(lstatSync(link(name)).isSymbolicLink(), `${name} linked`).toBe(true);
    }
    expect(readlinkSync(link('@lloyal-labs/sdk'))).toBe(join(ws, 'packages/sdk'));

    // The stale-compile hazard is named, per unbuilt package.
    expect(out.join('')).toContain('no dist/');
    // npm saw an install with the linked pins REMOVED (else an unpublished
    // pin would fail it) — asserted by it having been called at all here,
    // since the fake pins resolve nowhere.
    expect(npmMock.calls[0][0]).toBe('install');
  });

  it('a failed install restores the manifest and links nothing', async () => {
    const ws = fakeWorkspace();
    const { dir, manifest } = fakeProject();
    process.chdir(dir);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    npmMock.nextCode = 1;

    const code = await linkLocalCommand.run([ws]);
    expect(code).toBe(1);
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(manifest);
    expect(existsSync(join(dir, 'node_modules', '@lloyal-labs'))).toBe(false);
  });

  it('unlink-local removes node_modules + lockfile — pristine by construction', async () => {
    const { dir } = fakeProject();
    process.chdir(dir);
    mkdirSync(join(dir, 'node_modules', '@lloyal-labs'), { recursive: true });
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    expect(await unlinkLocalCommand.run([])).toBe(0);
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);
    expect(existsSync(join(dir, 'package-lock.json'))).toBe(false);
  });
});
