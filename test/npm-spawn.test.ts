/**
 * `spawn('npm')` was dead on Windows.
 *
 * Node 18.20.2 / 20.12.2 / 22+ refuse to spawn a `.cmd` without `shell: true`
 * (CVE-2024-27980), and on Windows npm IS `npm.cmd` — so scaffold's post-install,
 * `lloyal install` and `lloyal publish` all threw EINVAL on Node 24. Reported
 * from the field, on 1.0.2, against a home directory containing a space.
 *
 * The space matters: `shell: true` alone would have fixed EINVAL and broken
 * `npm pack --pack-destination "C:\\Users\\First Last\\…"` by splitting the path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockSpawn = vi.fn(() => ({ on: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

const { spawnNpm, npmExit, resolveNpmInvocation, npmCliCandidates, UnsafeWindowsArgumentError } = await import('../src/npm-spawn');

const argsOf = () => mockSpawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
const ORIGINAL = process.env.npm_execpath;

beforeEach(() => { mockSpawn.mockClear(); });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.npm_execpath;
  else process.env.npm_execpath = ORIGINAL;
});

describe('spawnNpm', () => {
  it('runs npm\'s JS entry with the current node when npm_execpath is set', () => {
    process.env.npm_execpath = '/usr/lib/node_modules/npm/bin/npm-cli.js';
    spawnNpm(['install'], { cwd: '/tmp/x' });
    const [cmd, argv, opts] = argsOf();
    expect(cmd).toBe(process.execPath);
    expect(argv).toEqual(['/usr/lib/node_modules/npm/bin/npm-cli.js', 'install']);
    // No shell: nothing re-parses the arguments, so nothing needs quoting.
    expect(opts.shell).toBe(false);
    expect(opts.cwd).toBe('/tmp/x');
  });

  it('ignores npm_execpath when it is not a JS entry', () => {
    // npm_execpath can point at a shim; only a .js/.cjs/.mjs entry is runnable
    // by `node`, and guessing wrong would fail at spawn rather than here.
    //
    // Assert the INTENT — the shim is never handed to node — rather than which
    // fallback wins. Step 2 finds npm-cli.js beside node on a normal install, so
    // `cmd` is legitimately `process.execPath` there; an earlier version of this
    // test asserted otherwise and passed only where that lookup failed.
    process.env.npm_execpath = '/usr/local/bin/npm';
    spawnNpm(['install']);
    const [, argv] = argsOf();
    expect(argv).not.toContain('/usr/local/bin/npm');
    expect(argv[argv.length - 1]).toBe('install');
  });

  it('passes arguments through untouched when there is no shell', () => {
    process.env.npm_execpath = '/npm/npm-cli.js';
    const dir = '/tmp/First Last/pack out';
    spawnNpm(['pack', '--pack-destination', dir, '--json']);
    // The space-bearing path arrives as ONE argv entry, unquoted. Quoting it
    // here would make npm create a directory with literal quote marks.
    expect(argsOf()[1]).toContain(dir);
  });
});

describe('resolveNpmInvocation — every branch, including the one this machine cannot run', () => {
  const NODE = '/usr/bin/node';
  const JS = '/npm/bin/npm-cli.js';

  it('POSIX without npm_execpath runs plain npm, no shell', () => {
    expect(resolveNpmInvocation(['install'], 'darwin', undefined, NODE, () => false))
      .toEqual({ cmd: 'npm', argv: ['install'], shell: false });
  });

  it('Windows without npm_execpath needs npm.cmd AND a shell', () => {
    // Without shell:true Node throws EINVAL on a .cmd since CVE-2024-27980.
    // That is the reported bug, pinned.
    const r = resolveNpmInvocation(['install'], 'win32', undefined, NODE, () => false);
    expect(r.cmd).toBe('npm.cmd');
    expect(r.shell).toBe(true);
  });

  it('Windows quotes a path containing a space as ONE argument', () => {
    const dir = 'C:\\Users\\First Last\\tmp';
    const r = resolveNpmInvocation(['pack', '--pack-destination', dir], 'win32', undefined, NODE, () => false);
    expect(r.argv).toHaveLength(3);
    expect(r.argv[2]).toBe(`"C:\\Users\\First Last\\tmp"`);
  });

  it('Windows doubles a trailing backslash so it cannot escape the closing quote', () => {
    // `"C:\tmp\"` would let the final backslash escape the quote at the
    // CommandLineToArgvW layer and swallow the following argument.
    const r = resolveNpmInvocation(['pack', 'C:\\tmp\\', '--json'], 'win32', undefined, NODE, () => false);
    expect(r.argv[1]).toBe('"C:\\tmp\\\\"');
    expect(r.argv[2]).toBe('--json');       // the next argument survives
  });

  it('npm_execpath wins on Windows too — no shell, nothing to quote', () => {
    const dir = 'C:\\Users\\First Last\\tmp\\';
    const r = resolveNpmInvocation(['pack', dir], 'win32', JS, NODE);
    expect(r).toEqual({ cmd: NODE, argv: [JS, 'pack', dir], shell: false });
  });

  it('refuses a cmd metacharacter rather than pretending quotes contain it', () => {
    // cmd expands %VAR% inside double quotes and leaves & | < > ^ ! live. There
    // is no escape for that in an argument passed through `cmd /c`, so the only
    // honest options are refuse or corrupt. Refuse, and say how to leave this path.
    for (const bad of ['acme/%PATH%-ability', 'a&b', 'a|b', 'a^b', 'a<b', 'a>b', 'a!b']) {
      expect(() => resolveNpmInvocation(['install', bad], 'win32', undefined, NODE, () => false))
        .toThrow(UnsafeWindowsArgumentError);
    }
  });

  it('the refusal names the argument and the way out', () => {
    try {
      resolveNpmInvocation(['install', 'a&b'], 'win32', undefined, NODE, () => false);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('a&b');
      expect((e as Error).message).toContain('nodejs.org');
    }
  });

  it('does NOT refuse when npm\'s JS entry is reachable — nothing parses the argument', () => {
    const entry = npmCliCandidates(NODE, 'win32')[0];
    const r = resolveNpmInvocation(['install', 'acme/%PATH%-ability'], 'win32', undefined, NODE, (p) => p === entry);
    expect(r.shell).toBe(false);
    expect(r.argv).toContain('acme/%PATH%-ability');
  });

  it('leaves ordinary arguments unquoted', () => {
    expect(resolveNpmInvocation(['install', '--ignore-scripts'], 'win32', undefined, NODE, () => false).argv)
      .toEqual(['install', '--ignore-scripts']);
  });
});

describe('cmd.exe is avoided when npm\'s JS entry can be found', () => {
  const NODE_WIN = 'C:\\Program Files\\nodejs\\node.exe';

  it('runs npm-cli.js beside node.exe rather than npm.cmd', () => {
    const expected = npmCliCandidates(NODE_WIN, 'win32')[0];
    const r = resolveNpmInvocation(['install'], 'win32', undefined, NODE_WIN, (p) => p === expected);
    expect(r.shell).toBe(false);
    expect(r.cmd).toBe(NODE_WIN);
    expect(r.argv).toEqual([expected, 'install']);
  });

  it('leaves a %VAR% argument untouched — cmd expands those even inside quotes', () => {
    // `lloyal install <publisher>/<name>` puts caller-supplied text here, and
    // there is no escape for % in an argument passed through `cmd /c`.
    const expected = npmCliCandidates(NODE_WIN, 'win32')[0];
    const spec = 'acme/%PATH%-ability';
    const r = resolveNpmInvocation(['install', spec], 'win32', undefined, NODE_WIN, (p) => p === expected);
    expect(r.shell).toBe(false);
    expect(r.argv).toContain(spec);
  });
});

/**
 * The adapter every verb that must KNOW whether npm succeeded goes through, and the whole matrix of
 * what a child process can do on the way out. A verb that reads a wrong number here either packages
 * a build that failed or refuses one that worked.
 */
describe('npmExit', () => {
  const child = (): EventEmitter => {
    const c = new EventEmitter();
    mockSpawn.mockReturnValueOnce(c as unknown as { on: typeof vi.fn });
    return c;
  };

  it('answers the exit code npm closed with', async () => {
    const c = child();
    const code = npmExit(['--version'], '/somewhere');
    c.emit('close', 0);
    expect(await code).toBe(0);

    const d = child();
    const failed = npmExit(['run', 'nope'], '/somewhere');
    d.emit('close', 3);
    expect(await failed).toBe(3);
  });

  /** A process killed by a signal closes with a null code. Nothing ran to completion, so it failed. */
  it('treats a close with no code as a failure', async () => {
    const c = child();
    const code = npmExit(['install'], '/somewhere');
    c.emit('close', null);
    expect(await code).toBe(1);
  });

  /** npm that could not be started at all is indistinguishable, to the caller, from npm that ran badly. */
  it('treats a failure to spawn as a failure, rather than rejecting', async () => {
    const c = child();
    const code = npmExit(['install'], '/somewhere');
    c.emit('error', new Error('ENOENT'));
    await expect(code).resolves.toBe(1);
  });

  it('runs in the directory it was given, with npm\'s own output left visible', async () => {
    const c = child();
    const code = npmExit(['install'], '/a/project');
    c.emit('close', 0);
    await code;
    const [, , opts] = mockSpawn.mock.calls[mockSpawn.mock.calls.length - 1] as unknown as [string, string[], Record<string, unknown>];
    expect(opts.cwd).toBe('/a/project');
    expect(opts.stdio).toBe('inherit');
  });
});
