/**
 * A brief's life: asked, framed, written, settled. This file is what a reader can do and what happens when they
 * do it; what the MODEL does at each step is the research this is handed.
 *
 * It is also the only place the trunk is written — the trunk being the model's running memory of one brief's
 * conversation. An ask into the brief on the canvas threads onto the trunk when the trunk holds that brief; any
 * other ask begins a new brief on a fresh one. No handler waits on the model: each hands its work to `run` and
 * returns, which is why a Stop is always heard.
 */
import { scoped } from "effection";
import type { Channel, Operation } from "effection";
import type { Session } from "@lloyal-labs/sdk";
import { waitUntilSettled } from "@lloyal-labs/lloyal-agents";
import { admitted, singleTaskPlan, OperationFailure } from "@lloyal-labs/rig";
import type { Execution, Handlers, PlanResult, ResearchTask, Coverage } from "@lloyal-labs/rig";
import type { Descriptor } from "@lloyal-labs/media";
import type { Inputs, Research } from "../harness/research.js";
import type { Config } from "../config.js";
import type { Library } from "./library.js";
import type { BriefEvent, Command, DocId, Mode, WorkflowEvent } from "../protocol.js";
import { docEvent, errorMessage, HarnessExit } from "../protocol.js";
import { render } from "../harness/prompts.js";

/** A planner result held for the reader's yes, with the round the interface echoes back. */
type PendingPlan = { plan: PlanResult; inputs: Inputs; revision: number };

const STALE_PLAN = { type: "ui:error", message: "The plan changed under you; have another look." } as const;

/** THE echo — the first thing said about every accepted ask. */
const queryEvent = (ask: Inputs, { warm }: { warm: boolean }): Extract<BriefEvent, { type: "query" }> => ({
  type: "query",
  docId: ask.docId,
  query: ask.text,
  warm,
  ...(ask.direct ? { direct: true } : {}),
  effort: ask.effort,
  ...(ask.attachments.length ? { attachments: [...ask.attachments] } : {}),
});

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
  /** Whatever is in flight — a run, or a plan awaiting its yes — stops, and the canvas is told. What the app gives
   *  up after a handler threw on a healthy run (`serveDefaults`' `abandon`): the next ask starts clean. */
  abortRun(): Operation<void>;
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

  // What a reader can do, by the moment they do it in; how each is done is below. (Function declarations are
  // hoisted, so the table can come first.)
  return {
    handlers: {
      // Ask
      *submit_query(c) {
        yield* submit(c.query, { mode: c.mode, direct: !!c.skipPlanner, attachments: c.attachments });
      },
      *toggle_participation({ name }) {
        participation[name] = participation[name] === false;
        yield* wire.send({ type: "participation:toggled", name, included: participation[name] });
      },

      // Frame: every gesture names the planning round it saw (`revision`); one that is over is refused.
      *submit_clarification({ revision: rev, answer }) {
        if (!pendingPlan) return;
        if (pendingPlan.revision !== rev) return yield* wire.send(STALE_PLAN);
        const { plan, inputs } = pendingPlan;
        pendingPlan = null;   // the round is over; a late answer to it finds nothing
        yield* wire.send(queryEvent(inputs, { warm: false }));
        yield* startRun(inputs, function* () {
          // The round joins the trunk as it is answered: the question paired with what was asked, then the answer as the
          // open user side the planner's fork reads. A round the reader walks away from leaves nothing on the trunk.
          yield* commitAnswer(inputs.text, render("clarify", { questions: plan.clarifyQuestions }));   // the planner's questions as the assistant's turn, so the next fork attends the dialogue
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
      *update_task_description({ revision: rev, index, description }) {
        yield* updatePlan(rev, (t) => t.map((task, i) => (i === index ? { ...task, description } : task)));
      },
      *add_task({ revision: rev, afterIndex }) {
        yield* updatePlan(rev, (t) => { const at = Math.max(0, Math.min(t.length, afterIndex + 1)); return [...t.slice(0, at), { description: "" }, ...t.slice(at)]; });
      },
      *delete_task({ revision: rev, index }) {
        yield* updatePlan(rev, (t) => (t.length > 1 && index >= 0 && index < t.length ? t.filter((_, i) => i !== index) : t));   // a plan keeps at least one task
      },
      *move_task({ revision: rev, from, to }) {
        yield* updatePlan(rev, (t) => {
          if (from === to || from < 0 || from >= t.length || to < 0 || to >= t.length) return t;
          const next = [...t]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next;
        });
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

      // Write: the controls of the live run. `run` owns it, so these only pass the word along.
      *stop() { yield* abortRun(); },
      *wrap_up() { run.wrapUp(); },
      *pause() { run.pause(); },
      *resume() { run.resume(); },
      *cancel_agent({ agentId }) { run.cancel(agentId); },

      // Settle
      *open_doc({ docId }) { yield* openDoc(docId); },
      *new_run() {
        yield* abortRun();
        yield* openDoc(null);
      },
    },
    submit,
    abortRun: () => abortRun(),
  };

  // ── Ask ────────────────────────────────────────────────────────────────────

  /** Begin a brief, or ask into the one shown. Returns the accepted run, or null when the ask was refused. */
  function* submit(text: string, opts: SubmitOptions = {}): Operation<Operation<void> | null> {
    const { mode = config().defaults.reasoningMode, direct = false, attachments = [], review = true } = opts;
    const seen = yield* admitted(attachments);   // the claims checked once: shape, store, sight
    if ("refused" in seen) {
      yield* wire.send({ type: "ui:error", message: seen.refused });
      return null;
    }
    const warm = direct && activeDocId !== null;   // into the brief on the canvas; whether that is a first report or an exchange is the library's to say
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
      // Everything that touches the model runs in here, under the run, where Stop can reach it. The trunk is
      // trusted only when it holds this brief's thread with every pair closed; anything less is released and
      // rebuilt from the library.
      //
      // `waitUntilSettled` is how a call into the model is awaited. A Stop halts this operation at once, but a
      // call already inside the model cannot be dropped half way: the halt waits for it to finish before
      // anything it touched is released. Wrap every call on `session` in it.
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

  /** The plan the canvas frames, said only here: from what the planner returned, and again whenever the reader
   *  edits it. A planner's own progress may say anything on the wire; the brief's state is the value it hands back. */
  function* publish(plan: PlanResult): Operation<void> {
    yield* wire.send({ type: "plan", intent: plan.intent, tasks: plan.tasks, clarifyQuestions: plan.clarifyQuestions, tokenCount: plan.tokenCount, timeMs: plan.timeMs });
  }

  /** Plan the brief. The plan waits for the reader's yes — unless the model must ask first, or can answer at once. */
  function* frame(ask: Inputs, review: boolean): Operation<void> {
    // The brief opens the round, not the planner: `plan:start` withdraws whatever review the canvas is showing
    // and clears the last round's plan. A planner only has to return a value, so it must not be the one the
    // canvas is waiting to hear from.
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

  /** Change the parked plan and say the plan again, whole — only for the round the interface saw; a stale
   *  edit is refused. The rules of an edit live here alone: the view shows whatever plan it is told. */
  function* updatePlan(rev: number, change: (tasks: ResearchTask[]) => ResearchTask[]): Operation<void> {
    if (!pendingPlan) return;
    if (pendingPlan.revision !== rev) return yield* wire.send(STALE_PLAN);
    pendingPlan = { ...pendingPlan, plan: { ...pendingPlan.plan, tasks: change(pendingPlan.plan.tasks) } };
    yield* publish(pendingPlan.plan);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /** Write the brief. The brief says the writing began and ended, and keeps what came back: the writer it was
   *  handed only has to return a value, and may say as much or as little on the wire as it likes. */
  function* write(ask: Inputs, plan: PlanResult, warm: boolean): Operation<void> {
    library.begin(ask.docId, ask, { warm });   // its folder: a first report, or a thread beside a settled one
    yield* wire.send({ type: "research:start", agentCount: plan.tasks.length, mode: ask.mode, reports: research.reports ?? null });
    const written = yield* research.write(session.trunk, ask, plan);
    yield* commitAnswer(ask.text, written.answer);
    library.written(ask.docId, written);   // held until `complete` is said, which is when the report is made
    yield* wire.send({ type: "answer", text: written.answer });
    yield* wire.send({ type: "stats", ...written.stats });
    live = null;   // said as complete, nothing here is left for a stop to abort; what follows is bookkeeping a replacement may cut short
    yield* wire.send({ type: "complete", data: written.complete });
    yield* library.settled(ask.docId);   // it joined the shelf as `complete` was said; now the sources that read the shelf
  }

  /** The answer joins the trunk: it closes the reader's side when one is open, else lands as a pair with its question. */
  function* commitAnswer(question: string, text: string | null): Operation<void> {
    if (!text) return;
    yield* waitUntilSettled(session.userSidePending ? session.prefillAssistant(text) : session.commitTurn(question, text));
  }

  /** Run one step of a brief's life under `run`, the session's one owner of long work, and return the accepted
   *  run. `scoped` is the boundary: whatever the body starts — agents, forks of the model's state — is finished
   *  and cleaned up before the run counts as over, so the next run never meets this one's leftovers.
   *
   *  A failure of the body releases the brief's folder, says why, and is recorded on the run. One case is kept
   *  apart. If this run is no longer the live one, it is being stopped, and an error arriving then is rethrown
   *  untouched for `run` to judge: a cleanup that failed means the model's state cannot be trusted. `run` cannot
   *  tell that from the body's own failure arriving late, so the one failure raised here deliberately,
   *  `HarnessExit`, is marked as the body's own. */
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

}

export interface SubmitOptions {
  mode?: Mode;
  direct?: boolean;
  attachments?: Descriptor[];
  /** Whether a research plan waits for the reader's yes. A one-shot run has no reader. */
  review?: boolean;
}
