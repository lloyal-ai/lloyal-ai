import { describe, it, expect, vi, afterEach } from 'vitest';
import { main } from '../src/cli.js';
import { findCommand, SUBCOMMANDS } from '../src/commands/index.js';

function captureStderr(): { output: () => string; restore: () => void } {
  let buf = '';
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    buf += chunk.toString();
    return true;
  });
  return { output: () => buf, restore: () => spy.mockRestore() };
}
function captureStdout(): { restore: () => void } {
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  return { restore: () => spy.mockRestore() };
}

afterEach(() => vi.restoreAllMocks());

describe('dispatcher — unknown command', () => {
  it('errors (exit 1) and suggests `new`, does NOT scaffold', async () => {
    const err = captureStderr();
    const code = await main(['approve']);
    err.restore();
    expect(code).toBe(1);
    expect(err.output()).toContain('unknown command "approve"');
    expect(err.output()).toContain('lloyal new approve');
  });

  it('does not suggest `new` for a flag-like token', async () => {
    const err = captureStderr();
    const code = await main(['--frobnicate']);
    err.restore();
    expect(code).toBe(1);
    expect(err.output()).toContain('unknown command "--frobnicate"');
    expect(err.output()).not.toContain('new --frobnicate');
  });
});

describe('dispatcher — help + version', () => {
  it('bare invocation prints help (exit 0)', async () => {
    const out = captureStdout();
    const code = await main([]);
    out.restore();
    expect(code).toBe(0);
  });

  it('--help prints help (exit 0)', async () => {
    const out = captureStdout();
    const code = await main(['--help']);
    out.restore();
    expect(code).toBe(0);
  });

  it('--version prints the version (exit 0)', async () => {
    const out = captureStdout();
    const code = await main(['--version']);
    out.restore();
    expect(code).toBe(0);
  });
});

/**
 * The top-level listing is a hand-written literal, so a command can be registered and never
 * mentioned — which is how `link-local` came to be missing from it. This row is the boundary: a new
 * verb either appears in the listing or is named below as one that deliberately does not.
 */
describe('the help listing and the registry agree', () => {
  /** The platform-development verbs: they link a project against a checkout of lloyal itself, so they
   *  are for people working ON the platform and not part of a harness developer's surface. */
  const UNLISTED = new Set(['link-local', 'unlink-local']);

  it('mentions every registered command, or says why not', async () => {
    let out = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out += chunk.toString();
      return true;
    });
    await main(['--help']);
    spy.mockRestore();
    const missing = SUBCOMMANDS.map((c) => c.name).filter((n) => !UNLISTED.has(n) && !out.includes(`lloyal ${n}`));
    expect(missing).toEqual([]);
  });

  it('lists `ship`, which is how anybody finds out a harness can become an app', async () => {
    let out = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out += chunk.toString();
      return true;
    });
    await main(['--help']);
    spy.mockRestore();
    expect(out).toContain('lloyal ship');
    expect(findCommand('ship')?.name).toBe('ship');
  });
});

describe('findCommand', () => {
  it('resolves the `new` verb + named subcommands', () => {
    expect(findCommand('new')?.name).toBe('new');
    expect(findCommand('ability:new')?.name).toBe('ability:new');
    expect(findCommand('install')?.name).toBe('install');
  });

  it('returns undefined for retired/unknown tokens (so the dispatcher errors)', () => {
    // `create` and `ability` were renamed — no backward-compat alias.
    expect(findCommand('create')).toBeUndefined();
    expect(findCommand('ability')).toBeUndefined();
    expect(findCommand('approve')).toBeUndefined();
    expect(findCommand('bogus')).toBeUndefined();
  });
});
