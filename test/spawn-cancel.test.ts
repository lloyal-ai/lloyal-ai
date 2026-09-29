/**
 * The runner owns real operating-system processes, so these are real processes.
 *
 * An assertion that `kill()` was called proves nothing here: `child.kill()` signals the child and
 * npm's children are the ones doing the work, so the packager survives its parent. Each row below
 * builds an actual process tree and counts what is left afterwards.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { runStep } from '../src/npm-spawn.js';

const NODE = process.execPath;
const posix = process.platform !== 'win32';
const markers: string[] = [];

/** A unique token that appears in the child's argv, so `pgrep -f` can count it. */
const marker = (what: string): string => {
  const m = `runstep-${what}-${process.pid}-${markers.length}`;
  markers.push(m);
  return m;
};

const living = (m: string): number => {
  try {
    return execFileSync('pgrep', ['-f', m], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;   // pgrep exits non-zero when nothing matches
  }
};

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  for (const m of markers.splice(0)) spawn('pkill', ['-f', m], { stdio: 'ignore' });
});

describe('runStep owns the process tree it starts', () => {
  it('captures stdout and stderr together, with the exit code', async () => {
    const step = runStep(NODE, ['-e', 'process.stdout.write("out;"); process.stderr.write("err;"); process.exit(3)'], { cwd: tmpdir() });
    const { code, output } = await step.join();
    expect(code).toBe(3);
    expect(output).toContain('out;');
    expect(output).toContain('err;');
  });

  /** The case the synchronous version cannot survive: `execFileSync` dies with ENOBUFS once a
   *  child says more than 2 MB, and a packager says far more than that. */
  it('completes a child that says far more than a sync capture allows', async () => {
    const step = runStep(NODE, ['-e', 'process.stdout.write("x".repeat(4 * 1024 * 1024))'], { cwd: tmpdir() });
    const { code, output } = await step.join();
    expect(code).toBe(0);
    expect(output.length).toBeGreaterThan(4_000_000);
  });

  /** The wizard's phases are fed from here, so a line has to arrive whole and while it is still
   *  running — not only once the child has finished. */
  it('reports whole lines as the child says them', async () => {
    const heard: string[] = [];
    const step = runStep(
      NODE,
      ['-e', 'process.stdout.write("first\\n");setTimeout(()=>process.stdout.write("second\\n"),80)'],
      { cwd: tmpdir(), onLine: (line) => heard.push(line) },
    );
    await step.join();
    expect(heard).toEqual(['first', 'second']);
  });

  /** A `data` event is an arbitrary slice of the stream, not a line. Splitting each chunk on its
   *  own dropped markers depending on pipe timing — a valid line emitted in two writes produced
   *  nothing at all, which is how a packaging phase silently vanished from the wizard. */
  it('joins a line that arrives in two chunks', async () => {
    const heard: string[] = [];
    const step = runStep(
      NODE,
      ['-e', 'process.stdout.write("  • packa");setTimeout(()=>process.stdout.write("ging  platform=darwin\\n"),100)'],
      { cwd: tmpdir(), onLine: (line) => heard.push(line) },
    );
    await step.join();
    expect(heard).toEqual(['  • packa' + 'ging  platform=darwin']);
  });

  /** stdout and stderr interleave, so a half-line of one must not be completed by the other. */
  it("keeps each stream's partial line to itself, and flushes what has no newline", async () => {
    const heard: string[] = [];
    const step = runStep(
      NODE,
      ['-e', 'process.stdout.write("out-half");process.stderr.write("err-whole\\n");setTimeout(()=>process.stdout.write("-done"),60)'],
      { cwd: tmpdir(), onLine: (line) => heard.push(line) },
    );
    await step.join();
    expect(heard).toContain('err-whole');
    // No trailing newline: the child still said it, so it is delivered at close.
    expect(heard).toContain('out-half-done');
  });

  /** `stdio: ['ignore', …]` makes `child.stdin` null and the child reads EOF, so the payload mode
   *  is a distinct wiring rather than a flag. */
  it('hands a payload to a child on stdin', async () => {
    const step = runStep(
      NODE,
      ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write("got:"+s))'],
      { cwd: tmpdir(), stdin: 'payload', payload: '{"hello":"world"}' },
    );
    const { output } = await step.join();
    expect(output).toBe('got:{"hello":"world"}');
  });

  it.skipIf(!posix)('reaps a grandchild, which killing the child alone would orphan', async () => {
    const m = marker('grandchild');
    const step = runStep(
      NODE,
      ['-e', `require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)','${m}'],{stdio:'ignore'});setInterval(()=>{},1000)`, m],
      { cwd: tmpdir() },
    );
    await settle();
    expect(living(m)).toBe(2);

    await step.cancel();
    await settle();
    expect(living(m)).toBe(0);
  });

  it.skipIf(!posix)('kills a child that ignores SIGTERM, once its grace has run out', async () => {
    const m = marker('stubborn');
    const step = runStep(
      NODE,
      ['-e', `process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`, m],
      { cwd: tmpdir(), graceMs: 300 },
    );
    await settle();
    expect(living(m)).toBe(1);

    await step.cancel();
    expect(living(m)).toBe(0);
  });

  /** The case that a race against the CHILD's exit gets wrong: the one we hold dies politely and
   *  something it started does not, so waiting on the child reports success over a live process. */
  it.skipIf(!posix)('escalates when the child exits promptly but its descendant does not', async () => {
    const m = marker('survivor');
    const child = `require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",'${m}'],{stdio:'ignore'})`;
    const step = runStep(
      NODE,
      ['-e', `${child};process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`, m],
      { cwd: tmpdir(), graceMs: 300 },
    );
    await settle();
    expect(living(m)).toBe(2);

    await step.cancel();
    await settle();
    expect(living(m)).toBe(0);
  });
});
