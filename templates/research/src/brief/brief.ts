/**
 * A brief's life: asked, framed, written, settled. An ask into the brief the
 * canvas shows, while the trunk holds its thread, threads beneath it; anything
 * else begins a new brief. Two facts of the brief's own (`trunkDocId`,
 * `pendingPlan`) and two of the Session's (`trunk`, `userSidePending`) decide
 * every trunk write; nothing is shadowed. No handler waits on native work:
 * `submit`, `abortRun` and the clarification post to the owner and return.
 */
import { scoped } from "effection";
import type { Channel, Operation } from "effection";
import type { Session } from "@lloyal-labs/sdk";
import { waitUntilSettled } from "@lloyal-labs/lloyal-agents";
import { admitted, singleTaskPlan, OperationFailure } from "@lloyal-labs/rig";
import type { Execution, Handlers, PlanResult, ResearchTask, Coverage } from "@lloyal-labs/rig";
import type { Descriptor } from "@lloyal-labs/media";
import type { Inputs, Research } from "../research/research.js";
import type { Config } from "../app.js";
import type { Library } from "./library.js";
import type { Command, DocId, Mode, WorkflowEvent } from "./protocol.js";
import { queryEvent, docEvent, formatClarifyAsAssistantMsg, errorMessage, HarnessExit } from "./protocol.js";

/** A planner result held for the reader's yes, with the round the interface echoes back. */
type PendingPlan = { plan: PlanResult; inputs: Inputs; revision: number };

const STALE_PLAN = { type: "ui:error", message: "The plan changed under you; have another look." } as const;

export function briefs(deps: {
  session: Session;
  library: Library;
  run: Execution;
  wire: Channel<WorkflowEvent, void>;
  config: () => Config;
  research: Research;
}): {
  handlers: Handlers<Command>;
  submit(text: string, opts?: SubmitOptions): Operation<Operation<void> | null>;
  fail(err: unknown): Operation<"exit" | void>;
  fatal(): Operation<void>;
} {
  const { session, library, run, wire, config, research } = deps;
  let activeDocId: DocId | null = null;   // what the canvas shows; null is the picker
  let trunkDocId: DocId | null = null;    // the brief whose thread the trunk holds in full; null until it does
  let pendingPlan: PendingPlan | null = null;
  /** The brief the reader sees running: from an accepted ask until its run says `complete`, parks a plan, or dies. A stop
   *  while this is set aborts a run and may have landed a pair nobody was shown; a stop after it has nothing to abort. */
  let live: DocId | null = null;
  let revision = 0;
  const participation: Record<string, boolean> = {};   // per source, for the next ask; absent means on
  const coverage = new Map<string, Coverage>();                   // what each source was found to cover, for the session

  // ── Ask ────────────────────────────────────────────────────────────────────

  /** Begin a brief, or ask into the one shown. Returns the accepted run, or null when the ask was refused. */
  function* submit(text: string, opts: SubmitOptions = {}): Operation<Operation<void> | null> {
    const { mode = config().defaults.reasoningMode, direct = false, attachments = [], review = true } = opts;
    const seen = yield* admitted(attachments);   // the claims checked once: shape, store, sight
    if ("refused" in seen) {
      yield* wire.send({ type: "ui:error", message: seen.refused });
      return null;
    }
    const warm = direct && activeDocId !== null;
    let docId: DocId;
    try {
      docId = warm ? activeDocId! : library.reserve();   // a new brief owns its folder before anything is abandoned
    } catch (err) {
      yield* wire.send({ type: "ui:error", message: `Couldn't start a new document: ${errorMessage(err)}` });
      return null;   // a refused ask is a toast, never an abort
    }
    yield* abortRun({ keep: docId });
    activeDocId = docId;
    const ask: Inputs = {
      docId, text, mode, direct,
      effort: config().defaults.effort,
      attachments: seen.roots,
      excluded: Object.keys(participation).filter((name) => participation[name] === false),
      sources: yield* library.roots(docId, seen.roots),   // the thread's pictures and documents, this ask's included
      guards: config().defaults.guards,
    };
    yield* wire.send(queryEvent(ask, { warm }));   // the first thing said about every accepted ask
    return yield* startRun(ask, function* () {
      // Everything native runs under the run, where Stop can reach it. The trunk is trusted only when it holds
      // this brief's thread with every pair closed; anything less is released and rebuilt from the library.
      const holds = trunkDocId === docId && session.trunk !== null && !session.userSidePending;
      if (!holds) {
        trunkDocId = null;
        yield* waitUntilSettled(session.dispose());
        const thread = warm ? library.read(docId) : null;   // a settled brief comes back whole; an unfinished one starts clean
        if (thread) yield* waitUntilSettled(session.commitTurn(thread.title, thread.thread));
        trunkDocId = docId;   // once the thread is on the trunk; a halt above leaves it null, and the next ask repeats this
      }
      if (seen.bitmaps.length) {
        // Onto the trunk once: every agent forked from it attends the same cells. N agents cost one projection.
        yield* waitUntilSettled(session.prefillUserMultimodal(text, seen.bitmaps, { attachments: seen.projected }));
      }
      if (!direct) return yield* frame(ask, review);
      // The question is the plan: said on the wire so the canvas frames the ask the way it frames a planned one.
      const plan = singleTaskPlan(text);
      yield* wire.send({ type: "plan:start", query: text, mode });
      yield* publish(plan);
      yield* write(ask, plan, warm);
    });
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  /** The plan the canvas frames — said EXACTLY once, here, from what the algorithm returned. A planner's own
   *  progress may say anything on the wire; the brief's state is decided by the value it hands back. */
  function* publish(plan: PlanResult): Operation<void> {
    yield* wire.send({ type: "plan", intent: plan.intent, tasks: plan.tasks, clarifyQuestions: plan.clarifyQuestions, tokenCount: plan.tokenCount, timeMs: plan.timeMs });
  }

  /** Plan the brief. The plan waits for the reader's yes — unless the model must ask first, or can answer at once. */
  function* frame(ask: Inputs, review: boolean): Operation<void> {
    // The round opens HERE, before the planner runs. `plan:start` is not telemetry: it withdraws the
    // review the canvas is showing, drops the parked plan, sets the mode and empties the roster. An
    // algorithm the developer replaced returns a value and says nothing, so leaving this to the
    // algorithm left the reader looking at the previous round's outline — still acceptable — for as
    // long as the new planner took to think.
    yield* wire.send({ type: "plan:start", query: ask.text, mode: ask.mode });
    const plan = yield* research.plan(session.trunk, ask, coverage);
    yield* publish(plan);
    if (plan.intent === "clarify") {
      if (!review) throw new HarnessExit("Planner asked clarifying questions; non-TTY mode can't answer. Aborting.", 2);
      pendingPlan = { plan, inputs: ask, revision: ++revision };
      live = null;   // parked: a plan awaiting its answer, not a run
      return yield* wire.send({ type: "ui:clarify", revision });   // the round the answer must name; its pair joins the trunk when it is answered
    }
    if (plan.intent === "research" && review) {
      pendingPlan = { plan, inputs: ask, revision: ++revision };
      live = null;   // parked: a plan awaiting its yes, not a run
      return yield* wire.send({ type: "ui:plan_review", revision });
    }
    yield* write(ask, plan, false);   // a passthrough, or a plan nobody needs to see
  }

  /** Change the parked plan and say so — only the round the interface saw. A stale edit is refused. */
  function* updatePlan(rev: number, change: (tasks: ResearchTask[]) => ResearchTask[], said: WorkflowEvent): Operation<void> {
    if (!pendingPlan) return;
    if (pendingPlan.revision !== rev) return yield* wire.send(STALE_PLAN);
    pendingPlan = { ...pendingPlan, plan: { ...pendingPlan.plan, tasks: change(pendingPlan.plan.tasks) } };
    yield* wire.send(said);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /** Write the brief: its inquiries, then the settling pass. The answer joins the trunk and the library. */
  function* write(ask: Inputs, plan: PlanResult, warm: boolean): Operation<void> {
    library.begin(ask.docId, ask, { warm });   // its folder: a first report, or a thread beside a settled one
    const written = yield* research.write(session.trunk, ask, plan);
    yield* commitAnswer(ask.text, written.answer);
    yield* wire.send({ type: "answer", text: written.answer });
    yield* wire.send({ type: "stats", ...written.stats });
    live = null;   // said as complete, nothing here is left for a stop to abort; what follows is bookkeeping a replacement may cut short
    yield* wire.send({ type: "complete", data: written.complete });
    yield* library.settled(ask.docId);   // it joined the shelf as `complete` was said; now the sources that read the shelf
  }

  /** The answer joins the trunk: it closes the reader's side when one is open, else lands as a pair with its question. */
  function* commitAnswer(question: string, text: string): Operation<void> {
    if (!text) return;
    yield* waitUntilSettled(session.userSidePending ? session.prefillAssistant(text) : session.commitTurn(question, text));
  }

  /** One step of a brief's life, under the run's ownership. Returns the accepted run. An ordinary failure — the body's
   *  own, or a child's — releases the folder, says why, and stays on the run's future. A run no longer live is being
   *  halted: whatever reaches it then is rethrown as it came for the owner to judge.
   *
   *  What this catch CANNOT do is tell the body's own failure from a teardown failure raised inside it. Both arrive
   *  here by the same route: the pool's cleanups run within `body()`, so a branch that will not release surfaces
   *  exactly where a failed planner does (the poison law in `owner.scenario.test.ts` is that case). Only a failure
   *  this function raises ITSELF is known — `HarnessExit`, thrown forward by the framing with nothing unwinding — and
   *  only that one is marked as the operation's own. The rest keep the owner's fatal-during-halt reading, which is
   *  safe but, as the third review showed, can poison a session whose cleanup actually succeeded. Closing that needs
   *  the scope that RUNS a cleanup to say so; see docs/plan/review-3-findings.md. */
  function* startRun(ask: Inputs, body: () => Operation<void>): Operation<Operation<void>> {
    live = ask.docId;   // until the body says `complete`, parks, or dies below
    return yield* run.replace(ask.docId, () => scoped(function* () {   // the boundary: a failing child fails here, not the session
      try {
        yield* body();
      } catch (err) {
        if (err instanceof HarnessExit) throw new OperationFailure(err);   // the brief's own, raised forward
        if (live !== ask.docId) throw err;
        live = null;
        pendingPlan = null;
        trunkDocId = null;   // a write that failed may have left part of a turn; the next ask rebuilds from the library
        library.release(ask.docId);
        yield* wire.send({ type: "run:aborted" });
        yield* wire.send({ type: "ui:error", message: errorMessage(err) });
        throw err;   // the run's future records the failure; the dispatcher ignores it, the one-shot path exits with it
      }
    }));
  }

  /** Whatever is in flight — a run, or a plan awaiting its yes — stops; its folder is released unless it settled; the canvas is told. */
  function* abortRun({ keep = null }: { keep?: DocId | null } = {}): Operation<void> {
    const dying = live;
    const parked = pendingPlan?.inputs.docId ?? null;
    yield* run.stop();   // withdraws an accepted run and halts the live one; returns at once, `busy` holds until the model settles
    if (dying) trunkDocId = null;   // a stopped run may have landed a pair nobody was shown; the next ask rebuilds from the library
    live = null;
    pendingPlan = null;
    for (const id of new Set([dying, parked])) if (id && id !== keep) library.release(id);
    if (dying ?? parked) yield* wire.send({ type: "run:aborted" });
  }

  // ── Settle ─────────────────────────────────────────────────────────────────

  /** Move the canvas — view only, legal mid-run — and say so. */
  function* activateDoc(docId: DocId | null): Operation<void> {
    activeDocId = docId;
    yield* wire.send({ type: "doc:active", docId });
  }

  /** Open a brief: a settled one comes whole from disk to the canvas; the trunk is untouched until the next ask into it. */
  function* openDoc(docId: DocId | null): Operation<void> {
    if (docId === null) return yield* activateDoc(null);
    const thread = library.read(docId);
    if (thread) {
      yield* wire.send(docEvent(thread, yield* library.restored(thread)));
      return yield* activateDoc(docId);
    }
    if (library.unfinished(docId)) return yield* activateDoc(docId);   // the one being written is already on the canvas
    yield* wire.send({ type: "ui:error", message: "That brief is no longer there." });
  }

  return {
    submit,
    /** A handler threw. A poisoned owner ends the session; anything else abandons the run and says why. */
    *fail(err: unknown): Operation<"exit" | void> {
      yield* wire.send({ type: "ui:error", message: errorMessage(err) });
      if (run.poisoned) return "exit";   // the model's state cannot be trusted: the host reaps the session, or the process ends
      yield* abortRun();
    },
    /**
     * The model's state cannot be trusted again: say why, and end the session — settling this is
     * what ends the command loop, so nothing waits for a question to be asked first.
     *
     * The reader does not lose anything by this. The host reaps the session and closes the
     * connection, and the canvas says the session ended and offers a new one; staying open would
     * only mean browsing a brief that can no longer be worked on, and discovering that by asking.
     */
    *fatal(): Operation<void> {
      const err = yield* run.whenPoisoned;
      yield* wire.send({ type: "ui:error", message: `The session cannot continue: ${errorMessage(err)}` });
    },
    handlers: {
      *submit_query(c) {
        yield* submit(c.query, { mode: c.mode, direct: !!c.skipPlanner, attachments: c.attachments });
      },
      *submit_clarification({ revision: rev, answer }) {
        if (!pendingPlan) return;
        if (pendingPlan.revision !== rev) return yield* wire.send(STALE_PLAN);
        const { plan, inputs } = pendingPlan;
        pendingPlan = null;   // the round is over; a late answer to it finds nothing
        yield* wire.send(queryEvent(inputs, { warm: false }));
        yield* startRun(inputs, function* () {
          // The round joins the trunk as it is answered: the question paired with what was asked, then the answer as the
          // open user side the planner's fork reads. A round the reader walks away from leaves nothing on the trunk.
          yield* commitAnswer(inputs.text, formatClarifyAsAssistantMsg(plan.clarifyQuestions));
          yield* waitUntilSettled(session.prefillUser(answer));
          yield* frame(inputs, true);
        });
      },
      *change_mode({ mode }) {
        if (!pendingPlan) return;
        const inputs = { ...pendingPlan.inputs, mode };
        pendingPlan = null;   // the round is over; the next plan gets a new revision
        yield* wire.send(queryEvent(inputs, { warm: false }));
        yield* startRun(inputs, () => frame(inputs, true));
      },
      *accept_plan({ revision: rev }) {
        if (!pendingPlan) return;
        if (pendingPlan.revision !== rev) return yield* wire.send(STALE_PLAN);
        const { plan, inputs } = pendingPlan;
        pendingPlan = null;   // consumed once; a late second yes finds nothing
        if (plan.intent === "clarify") return yield* abortRun();
        yield* startRun(inputs, () => write(inputs, plan, false));
      },
      *cancel_plan() { yield* abortRun(); },
      *edit_plan() { yield* abortRun(); },
      *update_task_description({ revision: rev, index, description }) {
        yield* updatePlan(rev, (t) => t.map((task, i) => (i === index ? { ...task, description } : task)), { type: "plan:task_updated", index, description });
      },
      *add_task({ revision: rev, afterIndex }) {
        yield* updatePlan(rev, (t) => { const at = Math.max(0, Math.min(t.length, afterIndex + 1)); return [...t.slice(0, at), { description: "" }, ...t.slice(at)]; }, { type: "plan:task_added", afterIndex });
      },
      *delete_task({ revision: rev, index }) {
        yield* updatePlan(rev, (t) => (t.length > 1 && index >= 0 && index < t.length ? t.filter((_, i) => i !== index) : t), { type: "plan:task_deleted", index });
      },
      *move_task({ revision: rev, from, to }) {
        yield* updatePlan(rev, (t) => {
          if (from === to || from < 0 || from >= t.length || to < 0 || to >= t.length) return t;
          const next = [...t]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next;
        }, { type: "plan:task_moved", from, to });
      },
      *toggle_participation({ name }) {
        participation[name] = participation[name] === false;
        yield* wire.send({ type: "participation:toggled", name });
      },
      *new_run() {
        yield* abortRun();
        yield* openDoc(null);
      },
      *open_doc({ docId }) { yield* openDoc(docId); },
      *stop() { yield* abortRun(); },
      *wrap_up() { run.wrapUp(); },
      *pause() { run.pause(); },
      *resume() { run.resume(); },
      *cancel_agent({ agentId }) { run.cancel(agentId); },
    },
  };
}

export interface SubmitOptions {
  mode?: Mode;
  direct?: boolean;
  attachments?: Descriptor[];
  /** Whether a research plan waits for the reader's yes. A one-shot run has no reader. */
  review?: boolean;
}
