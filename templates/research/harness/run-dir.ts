/**
 * Per-query artifact sink.
 *
 * Subscribes to the WorkflowEvent stream forwarded by the harness's drain
 * and writes:
 *   <output-dir>/<docId>/
 *     report.md          — synth/passthrough answer with metadata + annexure index
 *     annexure-N.md      — one per research agent's `report` tool result
 *
 * A document is born at the shape selector; everything asked UNDER it belongs
 * to it. The run dir IS the topic's folder: a follow-up on a settled document
 * lands beside its report as `exchange-N.md` — one document per file, one
 * library row per folder, the whole thread in one place with no special list
 * logic anywhere.
 *
 * The sink is ONE value: the run in flight, or nothing. A run begins at
 * `start()`/`startThread()`, ends at `complete` (its files written) or at
 * `run:aborted` (nothing more written) — the one abort signal on the wire.
 * A `ui:error` is a toast and never touches it.
 *
 * Every served session owns its own sink over the SAME library, so a file
 * name is a reservation, never an observation: annexures and exchanges are
 * created exclusively, and a name another sink took is skipped.
 *
 * Trace.jsonl is NOT this sink's concern. Trace is session-scoped: opened
 * once at boot, captures every query (including warm follow-ups), closed
 * at process exit.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkflowEvent } from './events.js';

/** The answer event carries the raw stream — a leaked reasoning block ends
 *  at its close marker. The exported report keeps only the brief. */
const stripThink = (text: string): string => {
  const close = text.lastIndexOf('</think>');
  return close === -1 ? text : text.slice(close + '</think>'.length);
};

/** One run's books. */
interface Run {
  dir: string;
  query: string;
  mode: 'flat' | 'deep';
  /** Root manifest digests the query carried. The report keeps the
   *  ADDRESS; the content-addressed store keeps the bytes. */
  attachments: readonly string[];
  /** A follow-up on a settled document: `finish()` appends an exchange. */
  appending: boolean;
  /** Annexure numbers the anchored dir already held when this run began —
   *  the first name each of this run's annexures tries. */
  ordinalBase: number;
  inResearch: boolean;
  /** This run's agents, in spawn order: 1, 2, 3 … */
  spawnOrdinal: number;
  agentToOrdinal: Map<number, number>;
  /** Task description per ordinal (fan-out order = spawn order). */
  taskByOrdinal: Map<number, string>;
  /** Ordinal → the annexure number RESERVED on disk for it. */
  fileOf: Map<number, number>;
  lastAnswer: string | null;
  startedAt: number;
  synthStats: { tokens: number; ppl: number; timeMs: number } | null;
}

/** Create `<dir>/<prefix>-<n>.md` for the first free n ≥ `from`, exclusively.
 *  Two sinks racing for the same name cannot both win: the loser moves on. */
function reserve(dir: string, prefix: string, from: number): number {
  for (let n = from; ; n++) {
    try {
      fs.closeSync(fs.openSync(path.join(dir, `${prefix}-${n}.md`), 'wx'));
      return n;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}

export class RunDirSink {
  private run: Run | null = null;

  /** Continue a settled document's thread: same event flow, but `finish()`
   *  appends an exchange beside its report. No new dir, no new library item. */
  startThread(opts: { dir: string; query: string; mode: 'flat' | 'deep'; attachments?: readonly string[] }): void {
    const dir = path.resolve(opts.dir);
    let taken = 0;
    for (const name of fs.readdirSync(dir)) {
      const m = /^annexure-(\d+)\.md$/.exec(name);
      if (m) taken = Math.max(taken, Number(m[1]));
    }
    this.run = this.begin(dir, opts, { appending: true, ordinalBase: taken });
  }

  /** Begin a document's run-dir. The caller passes the dir — the folder IS
   *  the docId (`outputDir/<docId>`), minted once at the submit echo. Same-id
   *  reuse would overwrite report.md; unreachable because every planner
   *  submit mints a fresh id and every ask threads. */
  start(opts: { dir: string; query: string; mode: 'flat' | 'deep'; attachments?: readonly string[] }): string {
    const dir = path.resolve(opts.dir);
    fs.mkdirSync(dir, { recursive: true });
    this.run = this.begin(dir, opts, { appending: false, ordinalBase: 0 });
    return dir;
  }

  private begin(
    dir: string,
    opts: { query: string; mode: 'flat' | 'deep'; attachments?: readonly string[] },
    how: { appending: boolean; ordinalBase: number },
  ): Run {
    return {
      dir,
      query: opts.query,
      mode: opts.mode,
      attachments: opts.attachments ?? [],
      appending: how.appending,
      ordinalBase: how.ordinalBase,
      inResearch: false,
      spawnOrdinal: 0,
      agentToOrdinal: new Map(),
      taskByOrdinal: new Map(),
      fileOf: new Map(),
      lastAnswer: null,
      startedAt: Date.now(),
      synthStats: null,
    };
  }

  handle(ev: WorkflowEvent): void {
    const run = this.run;
    if (!run) return;
    switch (ev.type) {
      case 'research:start':
        run.inResearch = true;
        break;
      case 'research:done':
        run.inResearch = false;
        break;
      case 'fanout:tasks':
        ev.tasks.forEach((t, i) => run.taskByOrdinal.set(i + 1, t.description));
        break;
      case 'spine:task':
        run.taskByOrdinal.set(ev.taskIndex + 1, ev.description);
        break;
      case 'agent:spawn':
        if (run.inResearch && !run.agentToOrdinal.has(ev.agentId)) {
          run.spawnOrdinal += 1;
          run.agentToOrdinal.set(ev.agentId, run.spawnOrdinal);
        }
        break;
      case 'agent:return':
      case 'agent:recovered': {
        const ord = run.agentToOrdinal.get(ev.agentId);
        if (ord !== undefined) this.writeAnnexure(run, ord, ev.result);
        break;
      }
      case 'answer':
        run.lastAnswer = ev.text;
        break;
      case 'synthesize:done':
        run.synthStats = { tokens: ev.tokenCount, ppl: ev.ppl, timeMs: ev.timeMs };
        break;
      case 'complete':
        this.finish(run);
        break;
      case 'run:aborted':
        // Stopped short: annexures already written stay (the harness removes
        // a stillborn dir itself); nothing more is written for this run.
        this.run = null;
        break;
    }
  }

  private writeAnnexure(run: Run, ord: number, body: string): void {
    let n = run.fileOf.get(ord);
    if (n === undefined) {
      n = reserve(run.dir, 'annexure', run.ordinalBase + ord);
      run.fileOf.set(ord, n);
    }
    const desc = run.taskByOrdinal.get(ord) ?? '';
    const header = `# Annexure ${n}\n\n${desc ? `**Task:** ${desc}\n\n` : ''}---\n\n`;
    fs.writeFileSync(path.join(run.dir, `annexure-${n}.md`), header + body.trimEnd() + '\n', 'utf8');
  }

  private finish(run: Run): void {
    if (run.lastAnswer && run.query) {
      const refs = [...run.fileOf.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([ord, n]) => {
          const desc = run.taskByOrdinal.get(ord);
          return `- [Annexure ${n}](./annexure-${n}.md)${desc ? ` — ${desc}` : ''}`;
        })
        .join('\n');
      const annexureSection = refs ? `\n---\n\n## Annexures\n\n${refs}\n` : '';
      const answer = stripThink(run.lastAnswer).trim();

      const totalMs = Date.now() - run.startedAt;
      const stats = run.synthStats
        ? ` · ${run.synthStats.tokens} synth tokens · ppl ${run.synthStats.ppl.toFixed(2)}`
        : '';
      // Rides the EXISTING metadata line rather than adding one: `readReport`
      // slices a fixed 3-line header, and `listReports` matches only its head.
      // An older report simply carries no media segment.
      const media = run.attachments.length > 0 ? ` · media ${run.attachments.join(' ')}` : '';
      const meta = `> ${new Date().toISOString()} · ${run.mode}${stats} · ${(totalMs / 1000).toFixed(1)}s${media}`;
      const doc = `# ${run.query}\n\n${meta}\n\n${answer}\n${annexureSection}`;

      if (run.appending) {
        // A follow-up is its own document beside the report — same format,
        // its own meta line (its own timestamp and media digests), parsed by
        // the same reader. The folder is the thread; the name is reserved.
        const n = reserve(run.dir, 'exchange', 1);
        fs.writeFileSync(path.join(run.dir, `exchange-${n}.md`), doc, 'utf8');
      } else {
        fs.writeFileSync(path.join(run.dir, 'report.md'), doc, 'utf8');
      }
    }
    this.run = null;
  }
}
