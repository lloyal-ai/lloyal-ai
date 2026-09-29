/**
 * One way to run npm, because Windows has three ways to get it wrong.
 *
 * Node 18.20.2 / 20.12.2 / 22+ refuse to `spawn()` a `.cmd` or `.bat` without
 * `shell: true` — the CVE-2024-27980 ("BatBadBut") fix. On Windows npm IS
 * `npm.cmd`, so every direct `spawn('npm')` or `spawn('npm.cmd')` in this CLI
 * threw `EINVAL` on Node 24: scaffold's post-install, `lloyal install`, and
 * `lloyal publish`'s `npm pack`. The whole Windows path was dead.
 *
 * Adding `shell: true` alone trades one bug for a worse one. Under a shell the
 * arguments are re-parsed by cmd.exe, and `npm pack --pack-destination <dir>`
 * carries a temp path that routinely contains a space
 * (`C:\Users\First Last\AppData\…`), which would silently split into two
 * arguments and pack to the wrong place.
 *
 * So the order of preference is:
 *
 *   1. `npm_execpath` — set by npm and npx, and it points at npm's own JS entry.
 *      Running it with the current `process.execPath` means no shell, no `.cmd`,
 *      and no quoting rules to get wrong. This is the path `npx lloyal-ai …`
 *      takes, which is how most people meet this CLI.
 *   2. POSIX — plain `spawn('npm')`, unchanged.
 *   3. Windows without `npm_execpath` — `npm.cmd` with `shell: true`, and
 *      arguments quoted here because under a shell that becomes our job.
 *
 * `cwd` is passed as a spawn option throughout and never interpolated into a
 * command string, so a directory with a space is safe on every path above.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** What `spawnNpm` decided to run. Separated from the spawn so it is testable. */
export interface NpmInvocation {
  cmd: string;
  argv: string[];
  /** Owned by this module — see `spawnNpm`, which overrides any caller value. */
  shell: boolean;
}

/** cmd.exe metacharacters. Quoting does not reliably neutralise these. */
const CMD_METACHARACTERS = /[%!&|<>^]/;

/**
 * Thrown when npm can only be reached through cmd.exe and an argument carries a
 * character cmd would interpret.
 */
export class UnsafeWindowsArgumentError extends Error {
  constructor(readonly argument: string) {
    super(
      `Cannot pass ${JSON.stringify(argument)} to npm on this machine.\n\n` +
        `npm's JavaScript entry could not be found, so the only remaining way to ` +
        `run it is through cmd.exe — and cmd interprets % ! & | < > ^ even inside ` +
        `double quotes. Passing this argument would corrupt it or execute part of ` +
        `it.\n\n` +
        `Reinstall Node.js from https://nodejs.org so npm-cli.js sits beside ` +
        `node.exe, or run the command through npm or npx, and this path is not used.`,
    );
    this.name = 'UnsafeWindowsArgumentError';
  }
}

/**
 * Quote one argument for a Windows command line.
 *
 * Handles what quoting CAN handle: spaces, embedded quotes, and trailing
 * backslashes — `C:\\tmp\\` naively quoted becomes `"C:\\tmp\\"`, where the final
 * backslash escapes the closing quote at the CommandLineToArgvW layer and
 * swallows the next argument.
 *
 * It does NOT handle cmd metacharacters, and no amount of quoting does: cmd
 * expands `%VAR%` inside double quotes, and `& | < > ^ !` remain live. Attempting
 * to escape them is how a quoting bug becomes an injection. Those arguments are
 * refused by {@link assertSafeForCmd} before they reach here.
 */
export function quoteForWindows(arg: string): string {
  if (arg.length > 0 && !/[\s"\\]/.test(arg)) return arg;
  const escaped = arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}

/** Refuse an argument cmd.exe would interpret. Only the shell path calls this. */
export function assertSafeForCmd(args: readonly string[]): void {
  for (const arg of args) {
    if (CMD_METACHARACTERS.test(arg)) throw new UnsafeWindowsArgumentError(arg);
  }
}

/**
 * Decide how to invoke npm. Pure: no spawn, no environment reads beyond the
 * arguments given, so every branch — including the Windows one that cannot run
 * on this machine — is directly testable.
 */
export function npmCliCandidates(nodeExecPath: string, platform: NodeJS.Platform): string[] {
  const dir = dirname(nodeExecPath);
  // Windows ships npm beside node.exe; POSIX puts it a level up in lib/.
  return platform === 'win32'
    ? [join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : [join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
}

export function resolveNpmInvocation(
  args: readonly string[],
  platform: NodeJS.Platform,
  npmExecPath: string | undefined,
  nodeExecPath: string = process.execPath,
  fileExists: (p: string) => boolean = existsSync,
): NpmInvocation {
  // 1. npm told us where it lives (npm, npx).
  if (npmExecPath && /\.[cm]?js$/i.test(npmExecPath)) {
    return { cmd: nodeExecPath, argv: [npmExecPath, ...args], shell: false };
  }
  // 2. Find npm's JS entry beside node. This exists to keep Windows OFF cmd.exe:
  //    under `shell: true`, cmd expands %VAR% even inside double quotes, and
  //    there is no escape for that in an argument passed to `cmd /c`. Since
  //    `lloyal install <publisher>/<name>` puts caller-supplied text on this
  //    path, running npm's JS directly is the only way to keep it uninterpreted.
  const found = npmCliCandidates(nodeExecPath, platform).find(fileExists);
  if (found) {
    return { cmd: nodeExecPath, argv: [found, ...args], shell: false };
  }
  if (platform !== 'win32') {
    return { cmd: 'npm', argv: [...args], shell: false };
  }
  // 3. Last resort. Quoting handles spaces and trailing backslashes; `%` remains
  //    expandable by cmd and cannot be escaped here, so this path is reached only
  //    when npm's JS entry is genuinely absent.
  assertSafeForCmd(args);
  return { cmd: 'npm.cmd', argv: args.map(quoteForWindows), shell: true };
}

/**
 * Run `npm <args>`.
 *
 * NOT a drop-in for `spawn('npm', …)` in one respect, deliberately: `opts.shell`
 * is IGNORED. Whether a shell is used is a consequence of how npm was resolved —
 * a caller passing `shell: true` alongside the node-entry path would break the
 * argument passing this module exists to get right — so the decision stays here.
 * Every other spawn option is forwarded untouched.
 */
export function spawnNpm(
  args: readonly string[],
  opts: SpawnOptions = {},
): ChildProcess {
  const { cmd, argv, shell } = resolveNpmInvocation(
    args,
    process.platform,
    process.env.npm_execpath,
  );
  return spawn(cmd, argv, { ...opts, shell });
}

/**
 * Run `npm <args>` to completion and answer its exit code.
 *
 * `spawnNpm` returns a process, and a verb that has to know whether npm SUCCEEDED has to wait for
 * it; a failure to spawn at all is an exit code too, since to the caller there is no difference
 * between npm not running and npm running badly. Stdio is inherited: npm's own progress and
 * warnings are the only report of a long install anybody wants.
 */
export function npmExit(args: readonly string[], cwd: string): Promise<number> {
  return new Promise<number>((settle) => {
    const child = spawnNpm(args, { cwd, stdio: 'inherit' });
    child.on('error', () => settle(1));
    child.on('close', (code) => settle(code ?? 1));
  });
}

/** What a finished child said and how it ended. `output` is stdout and stderr in arrival order. */
export interface StepResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly output: string;
}

/** A child this process owns: it can be waited on, and it can be stopped with its descendants. */
export interface Running {
  join(): Promise<StepResult>;
  /** Stop this child AND everything it started, then resolve once it is gone. */
  cancel(): Promise<void>;
}

/**
 * How a step's stdin is wired, which is not one answer.
 *
 * - `ignore` — the npm children. Nothing to say to them.
 * - `payload` — the notarize adapter. `stdin` must be a pipe or `child.stdin` is `null` and the
 *   child takes EOF before it has read anything.
 * - `terminal` — `notarytool store-credentials`, which puts up its own secure password prompt. It
 *   has to BE the foreground process group to read the tty, so this mode is the one that is not
 *   detached: a detached child gets SIGTTIN instead of the keystrokes.
 */
export type StdinMode = 'ignore' | 'payload' | 'terminal';

export interface RunOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: StdinMode;
  /** Written to the child and then closed, for `stdin: 'payload'`. */
  readonly payload?: string;
  /** Forward the child's output as it arrives, for a run nobody is drawing a spinner over. */
  readonly echo?: boolean;
  /** Called with each chunk as it arrives, for a caller showing what the child is up to. */
  readonly onData?: (chunk: string) => void;
  /** How long a SIGTERM has to work before the group is killed outright. */
  readonly graceMs?: number;
  /** Owned by {@link resolveNpmInvocation}, never by a caller — see {@link spawnNpm}. */
  readonly shell?: boolean;
}

const GRACE_MS = 5_000;

/**
 * Signal a child AND its descendants.
 *
 * `child.kill()` signals the child alone, and npm's children are the ones doing the work: killing
 * `npm run build:desktop` leaves electron-vite running. Measured — a child that spawns a grandchild
 * leaves the grandchild orphaned, while signalling the GROUP reaps both. Windows has no process
 * groups, so the tree is walked by `taskkill /T`.
 */
function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { stdio: 'ignore' });
      return;
    }
    process.kill(-pid, signal);
  } catch {
    /* already gone, and its exit has already been delivered or is on its way */
  }
}

/**
 * Is anything still running in this child's process group?
 *
 * Signal 0 delivers nothing and only asks the question, and asking it of `-pid` asks it of the
 * whole group — which is the thing that has to be empty before a cancel can claim to have worked.
 * Windows has no groups, so `taskkill /T` is both the question and the answer there.
 */
function groupAlive(pid: number): boolean {
  if (process.platform === 'win32') return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run one step of a long command, owning it for as long as it lives.
 *
 * Asynchronous throughout, which the synchronous alternative is not: `execFileSync` blocks the loop
 * a spinner is drawn on — 1547 ms of a 1500 ms child, with ZERO timer ticks, measured — and dies
 * with ENOBUFS once a child says more than 2 MB. Both pipes are drained here instead, so a noisy
 * packager cannot terminate its own step.
 *
 * `detached` is what makes the tree killable, and it is also what takes the child OUT of the
 * terminal's foreground group — so Ctrl-C no longer reaches it and signalling becomes this module's
 * job rather than the tty's. That is the whole reason cancellation lives here and not in the view.
 */
export function runStep(cmd: string, argv: readonly string[], opts: RunOptions): Running {
  const mode = opts.stdin ?? 'ignore';
  const owned = mode !== 'terminal';
  const child = spawn(cmd, [...argv], {
    cwd: opts.cwd,
    ...(opts.env ? { env: opts.env } : {}),
    shell: opts.shell === true,
    detached: owned,
    stdio: mode === 'terminal' ? 'inherit' : [mode === 'payload' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  const chunks: string[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (d: Buffer) => {
      const text = d.toString();
      chunks.push(text);
      if (opts.echo === true) process.stderr.write(text);
      opts.onData?.(text);
    });
  }
  if (mode === 'payload') {
    child.stdin?.end(opts.payload ?? '');
  }

  const ended = new Promise<StepResult>((settle) => {
    // A failure to spawn is an ending too: to the caller there is no difference between a command
    // that could not start and one that started and failed.
    child.on('error', (err) => settle({ code: 1, signal: null, output: `${chunks.join('')}${err.message}\n` }));
    child.on('close', (code, signal) => settle({ code, signal, output: chunks.join('') }));
  });

  return {
    join: () => ended,
    async cancel() {
      const { pid } = child;
      if (pid === undefined || !owned) {
        // A terminal-mode child is in the foreground group, so the tty has already signalled it.
        await ended;
        return;
      }
      const grace = opts.graceMs ?? GRACE_MS;
      const deadline = Date.now() + grace;
      killTree(pid, 'SIGTERM');

      // What has to be gone is the GROUP, not the child we happen to hold. A child that exits
      // promptly on SIGTERM while something it started ignores it would otherwise leave that
      // descendant running and this call would report success.
      let timer: NodeJS.Timeout | undefined;
      const lapsed = new Promise<void>((r) => { timer = setTimeout(r, grace); timer.unref?.(); });
      await Promise.race([ended, lapsed]);
      if (timer) clearTimeout(timer);
      while (groupAlive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      if (groupAlive(pid)) killTree(pid, 'SIGKILL');
      await ended;
    },
  };
}

/** {@link runStep} for npm, through the one invocation path this module exists to get right. */
export function runNpmStep(args: readonly string[], opts: RunOptions): Running {
  // `shell` travels with the resolution and is not the caller's to choose: on the last-resort
  // Windows path npm is `npm.cmd`, which cannot be spawned without it.
  const { cmd, argv, shell } = resolveNpmInvocation(args, process.platform, process.env.npm_execpath);
  return runStep(cmd, argv, { ...opts, shell });
}
