/**
 * runHarness(spec) — the behavioural rig: drives the REAL
 * `harness(ctx, events, commands)` over a scripted MockSessionContext and
 * captures everything a scenario can assert on — the wire (every
 * WorkflowEvent, in order), the engine trace (the trunk's `warmDelta`
 * commits and `branch:prune` releases: the KV law as data), and the run-dir
 * tree on disk.
 *
 * The pattern is lifted from packages/agents/test/invariants (`runPool`):
 * scripted determinism, event-driven choreography, no timers. What is new
 * is the layer — the command loop, the identity pointers, and the pipeline
 * composition all run REAL; only the model and the reranker are scripted.
 *
 * Scripting model — utterances, not fork indices. Each branch that SAMPLES
 * for the first time is assigned the next entry of `spec.utterances` (run
 * order is deterministic under the single-fiber pool). A branch streams
 * `stallTokens` filler ticks first (scheduling room for the command loop to
 * interleave — how "during a live run" scenarios exist without timers),
 * then ONE fat token whose text is the whole utterance, then stop.
 *
 *   kind 'text'   → parseChatOutput presents it as free-text content: the
 *                   planner's rawOutput (plan JSON), an Ask agent's direct
 *                   answer, the synth agent's brief.
 *   kind 'report' → parseChatOutput presents it as a terminal `report()`
 *                   tool call — what a non-Ask research agent must produce
 *                   to settle voluntarily.
 *
 * Choreography — `script` is a cursor of steps walked by the event stream:
 *   { send }      fire a command now (buffered until the loop arms).
 *   { on, send? } wait until an event matches, then optionally fire.
 * When the last step resolves, the rig sends `quit`; the harness returns;
 * the captured run comes back. A 30s watchdog fails loud instead of hanging.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "effection";
import { MockSessionContext } from "@lloyal-labs/sdk/dist/testing.js";
import type { SessionContext } from "@lloyal-labs/sdk";
import { createBus } from "@lloyal-labs/binding";
import { RerankerCtx } from "@lloyal-labs/lloyal-agents";
import type { Reranker, TraceWriter, TraceEvent } from "@lloyal-labs/lloyal-agents";
import { makeServedRunner } from "@lloyal-labs/rig";
import { harness } from "../../harness/harness.js";
import { RunnerCtx } from "../../harness/runner-ctx.js";
import { bufferedCommandSignal } from "../../harness/served-runtime.js";
import { SESSION_ORIGIN_MAP } from "../../harness/config.js";
import type { Config, ConfigOrigin } from "../../harness/config-types.js";
import type { WorkflowEvent, Command } from "../../harness/protocol.js";

const STOP = 999;
const FILLER = 7;
const UTTER_BASE = 50_000;

export interface Utterance {
  /** The branch's whole output — plan JSON, an answer, report findings. */
  text: string;
  /** How parseChatOutput presents it (see module doc). */
  kind: "text" | "report";
  /** Filler ticks streamed before the utterance — scheduling room for the
   *  command loop. A "live run" a scenario interrupts wants hundreds. */
  stallTokens?: number;
}

/** A step's command may be a THUNK, resolved at fire time — for commands
 *  that need data only the wire revealed (a minted docId captured by an
 *  earlier step's matcher). */
export type Sendable = Command | (() => Command);

export type Step =
  | { send: Sendable }
  | { on: (ev: WorkflowEvent) => boolean; send?: Sendable }
  /** Poll for loop-fiber state that has NO wire announcement (e.g. the
   *  clarify park arming `pendingPlan`): send `poke` commands whose echoes
   *  reveal the state; advance when `until` matches; re-poke when `repoke`
   *  matches (the pacing echo). Deterministic — the until-echo can only
   *  fire once the state exists. */
  | { until: (ev: WorkflowEvent) => boolean; repoke: (ev: WorkflowEvent) => boolean; poke: Command[]; send?: Sendable };

export interface HarnessSpec {
  /** Merged over the minimal config; `sources.outputDir` is always the
   *  rig's fresh temp dir (exposed on the run). */
  config?: Partial<Config>;
  utterances?: Utterance[];
  script?: Step[];
  /** Runs after the temp library dir exists, before the harness boots —
   *  where a scenario plants report fixtures. */
  setup?: (outputDir: string) => void;
  /** Wrap/override any ctx method AFTER the rig's scripting is wired but
   *  BEFORE the harness runs — same affordance as the agents invariants
   *  harness. Diagnosis and fault injection. */
  instrument?: (ctx: MockSessionContext) => void;
}

export interface HarnessRun {
  /** Every WorkflowEvent the wire carried, in order. */
  events: WorkflowEvent[];
  /** Every trace write — `branch:prefill role='warmDelta'` is a trunk
   *  commit; `branch:prune` of a warmDelta's handle is a trunk release. */
  trace: TraceEvent[];
  /** The library/run-dir root this run wrote (a fresh temp dir). */
  outputDir: string;
  /** `trace.length` at the moment quit was sent. Trace entries at or past
   *  this index are SHUTDOWN work (scope teardown disposes the live trunk,
   *  which rightly emits a release) — a scenario asserting "the trunk was
   *  never released" means never released BEFORE this mark. */
  shutdownTraceIndex: number;
}

class CapturingTrace implements TraceWriter {
  readonly events: TraceEvent[] = [];
  private _id = 1;
  nextId(): number {
    return this._id++;
  }
  write(event: TraceEvent): void {
    this.events.push(event);
    if (process.env.RIG_DEBUG === "1") {
      const e = event as TraceEvent & { role?: string; branchHandle?: number };
      console.error(`[rig] trace ${e.type}${e.role ? ` role=${e.role}` : ""}${e.branchHandle !== undefined ? ` h=${e.branchHandle}` : ""}`);
    }
  }
  flush(): void {}
}

/** A reranker that satisfies the ability factories and scores everything 0.
 *  Scenarios never assert on relevance — a real reranker is the platform's
 *  concern, not this harness's. */
const stubReranker: Reranker = {
  score: async function* () {},
  scoreBatch: async (_q, texts) => texts.map(() => 0),
  tokenizeChunks: async () => {},
  tokenize: async () => [],
  dispose: () => {},
};

const DEFAULT_ORIGIN: ConfigOrigin = {
  reasoningMode: "default",
  modelPath: "default",
  reranker: "default",
  nCtx: "default",
  gpu: "default",
  outputDir: "default",
  mmproj: "default",
};

function baseConfig(outputDir: string, over?: Partial<Config>): Config {
  return {
    version: 1,
    sources: { outputDir },
    abilities: {},
    defaults: { reasoningMode: "flat", effort: "low", maxTurns: 4 },
    model: {},
    ...over,
    // The output dir is the rig's regardless of what `over` carried.
    ...(over?.sources ? { sources: { ...over.sources, outputDir } } : { sources: { outputDir } }),
  };
}

/** Write a settled brief the library will list — the same 3-line header
 *  `readReport` parses (`# title`, blank, `> savedAt · mode · …`, body). */
export function writeReportFixture(
  outputDir: string,
  docId: string,
  title: string,
  body: string,
): void {
  const dir = path.join(outputDir, docId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "report.md"),
    [`# ${title}`, "", `> ${docId} · flat · 1s`, body].join("\n"),
  );
}

export async function runHarness(spec: HarnessSpec = {}): Promise<HarnessRun> {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-inv-"));
  spec.setup?.(outputDir);
  const utterances = spec.utterances ?? [];
  const steps = spec.script ?? [];

  const ctx = new MockSessionContext({ nCtx: 32_768 });

  // ── The utterance wiring (see module doc) ──
  let nextUtterance = 0;
  const assigned = new Map<number, { idx: number; produced: number }>();
  let lastSampled = 0;
  ctx._branchSample = (handle: number): number => {
    lastSampled = handle;
    let a = assigned.get(handle);
    if (!a) {
      a = { idx: nextUtterance++, produced: 0 };
      assigned.set(handle, a);
    }
    const u = utterances[a.idx];
    if (!u) return STOP; // unscripted branch — stops immediately
    const stall = u.stallTokens ?? 0;
    a.produced++;
    if (a.produced <= stall) return FILLER;
    if (a.produced === stall + 1) return UTTER_BASE + a.idx;
    return STOP;
  };
  ctx.tokenToText = (token: number): string => {
    if (token >= UTTER_BASE) return utterances[token - UTTER_BASE]?.text ?? "";
    return token === FILLER ? " ." : "";
  };
  ctx.parseChatOutput = (output, _format, opts) => {
    const a = assigned.get(lastSampled);
    const u = a ? utterances[a.idx] : undefined;
    if (opts?.isPartial || !u) {
      return { content: "", reasoningContent: "", toolCalls: [] };
    }
    if (u.kind === "report") {
      return {
        content: "",
        reasoningContent: "",
        toolCalls: [
          {
            id: "c1",
            name: "report",
            arguments: JSON.stringify({ result: u.text, sources: [] }),
          },
        ],
      };
    }
    return { content: u.text || output, reasoningContent: "", toolCalls: [] };
  };

  spec.instrument?.(ctx);

  const trace = new CapturingTrace();
  const runner = makeServedRunner<Config, ConfigOrigin>(
    baseConfig(outputDir, spec.config),
    {
      traceWriter: trace,
      dev: false,
      origin: DEFAULT_ORIGIN,
      sessionOriginMap: SESSION_ORIGIN_MAP,
    },
  );

  const events: WorkflowEvent[] = [];
  const bus = createBus<WorkflowEvent>();
  const rawCommands = bufferedCommandSignal<Command>();
  // RIG_DEBUG=1 narrates the choreography — every event with the cursor
  // position, every command sent. The first thing to reach for when a
  // scenario stalls.
  const debug = process.env.RIG_DEBUG === "1";
  const commands: typeof rawCommands = !debug ? rawCommands : {
    ...rawCommands,
    send: (c: Command) => {
      console.error(`[rig] send ${c.type}`);
      rawCommands.send(c);
    },
  };

  const fire = (c: Sendable): void =>
    commands.send(typeof c === "function" ? c() : c);

  // ── The choreography cursor ──
  let cursor = 0;
  let quitSent = false;
  let shutdownTraceIndex = -1;
  const finish = (): void => {
    if (!quitSent && cursor >= steps.length) {
      quitSent = true;
      shutdownTraceIndex = trace.events.length;
      commands.send({ type: "quit" } as Command);
    }
  };
  /** Advance through immediate sends and arm the next waiting step (a poll
   *  step fires its pokes on arrival). */
  const enterStep = (): void => {
    for (;;) {
      if (cursor >= steps.length) {
        finish();
        return;
      }
      const st = steps[cursor];
      if ("until" in st) {
        for (const c of st.poke) commands.send(c);
        return;
      }
      if ("on" in st) return;
      fire(st.send);
      cursor++;
    }
  };
  bus.subscribe((ev) => {
    events.push(ev);
    if (debug) console.error(`[rig] ev ${ev.type} (cursor ${cursor}/${steps.length})`);
    if (cursor >= steps.length) return;
    const st = steps[cursor];
    if ("until" in st) {
      if (st.until(ev)) {
        cursor++;
        if (st.send) fire(st.send);
        enterStep();
      } else if (st.repoke(ev)) {
        // Re-poke through a MACROTASK: effection delivers signal/channel
        // sends via synchronous reductions, so a same-tick re-poke forms an
        // unbroken sync cycle that starves the microtask queue — the run
        // fiber's awaits (the very state being polled for) never resume.
        const at = cursor;
        setImmediate(() => {
          if (cursor === at) for (const c of st.poke) commands.send(c);
        });
      }
    } else if ("on" in st && st.on(ev)) {
      cursor++;
      if (st.send) fire(st.send);
      enterStep();
    }
  });
  enterStep();

  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(function* () {
        yield* RunnerCtx.set(runner);
        yield* RerankerCtx.set(stubReranker);
        yield* harness(ctx as unknown as SessionContext, bus, rawCommands);
      }),
      new Promise<never>((_, reject) => {
        // REF'd on purpose: a stalled scenario drains the event loop, and an
        // unref'd timer never fires on a drained loop — the hang was silent.
        watchdog = setTimeout(
          () => reject(new Error(`runHarness timed out — cursor at step ${cursor}/${steps.length}; last event: ${events[events.length - 1]?.type}`)),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }

  return { events, trace: trace.events, outputDir, shutdownTraceIndex };
}

// ── Assertion helpers — the vocabulary scenarios speak ──

export const typesOf = (events: readonly WorkflowEvent[]): string[] =>
  events.map((e) => e.type);

type TraceLike = TraceEvent & {
  role?: string;
  speaker?: string;
  branchHandle?: number;
  content?: string;
};

/** The trunk's commits — one per turn the KV kept. */
export const warmDeltas = (trace: readonly TraceEvent[]): TraceLike[] =>
  (trace as TraceLike[]).filter(
    (t) => t.type === "branch:prefill" && t.role === "warmDelta",
  );

/** Prunes of a given handle — a trunk release when the handle committed turns. */
export const prunesOf = (trace: readonly TraceEvent[], handle: number): TraceLike[] =>
  (trace as TraceLike[]).filter(
    (t) => t.type === "branch:prune" && t.branchHandle === handle,
  );

/** Releases of a handle DURING the session — shutdown's own dispose (which
 *  rightly releases the live trunk) doesn't count. */
export const sessionReleasesOf = (run: { trace: readonly TraceEvent[]; shutdownTraceIndex: number }, handle: number): TraceLike[] =>
  (run.trace as TraceLike[]).filter(
    (t, i) => t.type === "branch:prune" && t.branchHandle === handle &&
      (run.shutdownTraceIndex < 0 || i < run.shutdownTraceIndex),
  );

/** The docId minted by the nth query event on the wire. */
export const docIdOfQuery = (events: readonly WorkflowEvent[], nth = 0): string => {
  const q = events.filter((e) => e.type === "query")[nth] as
    | { docId: string }
    | undefined;
  if (!q) throw new Error(`no query event #${nth} on the wire`);
  return q.docId;
};
