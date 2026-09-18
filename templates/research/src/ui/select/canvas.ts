/** What the canvas as a whole shows: which moment owns it, which document, the run bar's word, its controls
 *  and its clock. Every other selector module starts from the two documents found here — the one on the canvas
 *  and the one the run is writing — which are not always the same document. */
import { type AppState, type DocState, type DocPhase } from "../state.js";
import { emptyDoc } from "../reduce.js";
import { type Pace } from "../pace.js";
import { type Boot } from "./ask.js";

/** Which moment owns the canvas. Boot states render inside Ask. */
export type Moment = "ask" | "frame" | "write" | "settle";

/** The empty document — a VALUE, not a null-check. Selectors stay total:
 *  with no active document they derive from this and return their natural
 *  empties. Frozen so nothing can turn it into a place. */
const EMPTY_DOC: DocState = Object.freeze(emptyDoc());

/** The document the canvas shows; EMPTY_DOC at the picker. */
export const activeDoc = (app: AppState): DocState =>
  (app.activeDocId !== null ? app.documents.get(app.activeDocId) : undefined) ?? EMPTY_DOC;

/** The document the live run writes into; null when no run. */
export const runDoc = (app: AppState): DocState | null =>
  app.runDocId !== null ? app.documents.get(app.runDocId) ?? null : null;


/** What each phase of a document means to the reader: the moment that owns the canvas, the run bar's word, and
 *  whether the model is working. Total over `DocPhase`, so a phase added to the fold does not compile until it
 *  is given all three here. */
const PHASES: Record<DocPhase, { moment: Moment; status: string; live: boolean }> = {
  planning:     { moment: "frame",  status: "Framing",               live: true },
  discovering:  { moment: "frame",  status: "Browsing your sources", live: true },
  clarifying:   { moment: "frame",  status: "Framing",               live: false },
  plan_review:  { moment: "frame",  status: "Framing",               live: false },
  research:     { moment: "write",  status: "Writing",               live: true },
  synthesizing: { moment: "write",  status: "Writing",               live: true },
  done:         { moment: "settle", status: "Settled",               live: false },
};

/** Every phase, for a test that walks them all. */
export const DOC_PHASES = Object.keys(PHASES) as DocPhase[];

/** The canvas moment. An in-flight ask never leaves 'done' (the fold keeps that rule), and the picker is the
 *  absence of a document, so the table needs no overrides. */
export const selectMoment = (app: AppState): Moment =>
  app.activeDocId === null ? "ask" : PHASES[activeDoc(app).phase].moment;

/** The tab dot and the run-state lamp: work in progress ANYWHERE — a
 *  session truth, read off the run's document wherever the canvas is. */
export const selectLive = (app: AppState): boolean => {
  const d = runDoc(app);
  return d !== null && (PHASES[d.phase].live || d.ask !== null);
};

/** Whether the dev pane rides this wire. The ONE register exception hangs
 *  off it: with the pane docked, inquiry rows suffix the agent id the pane
 *  keys its rows by — correlation for the developer, invisible to everyone
 *  else. */
export const selectDev = (app: AppState): boolean => app.session.dev;

/** The one transient notice — a save confirmation, an error the run
 *  surfaced. Nothing else in the register floats, so this renders as a
 *  docked strip, not a toast. */
export const selectNotice = (
  app: AppState,
): { id: number; message: string; tone: "info" | "success" | "warn" | "error" } | null =>
  app.session.toast;

export const selectTaskCount = (app: AppState): number | null =>
  activeDoc(app).plan?.tasks.length ?? null;

/** The clock's two stable inputs — the Clock re-renders on its own ticker,
 *  so its selectors must hold ONE identity; a fresh inline closure per tick
 *  would grow the fold's memo map (see the store's contract). The clock
 *  rides the RUN, wherever the canvas is looking. */
export const selectBanked = (app: AppState): number =>
  runDoc(app)?.pipelineElapsedMs ?? 0;
export const selectResumedAt = (app: AppState): number | null =>
  runDoc(app)?.pipelineResumedAt ?? null;

/** The honest task count for time math. During research, the fork count is
 *  authoritative; while a plan is being framed or reviewed, its task list;
 *  idle, null — so estimates price each depth at its own preset breadth
 *  instead of the PREVIOUS run's plan. */
export const selectEtaTasks = (app: AppState): number | null => {
  const d = runDoc(app);
  if (!d) return null;
  if (d.phase === "research" || d.phase === "synthesizing") {
    return d.researchAgentCount || d.plan?.tasks.length || null;
  }
  if (d.phase === "planning" || d.phase === "plan_review" || d.phase === "clarifying") {
    return d.plan?.tasks.length ?? null;
  }
  return null;
};

/** The document the live run writes into; null when no run. */
export const selectRunDocId = (app: AppState): AppState["runDocId"] => app.runDocId;

export const selectTitle = (app: AppState): string =>
  activeDoc(app).query.replace(/\?\s*$/, "");

/** The run bar's title: the RUNNING document's question while one runs, the
 *  viewed document's otherwise. The canvas keeps `selectTitle` — a user may
 *  read a settled brief while another one writes, and the bar names what the
 *  controls beside it command. */
export const selectRunTitle = (app: AppState): string =>
  (runDoc(app) ?? activeDoc(app)).query.replace(/\?\s*$/, "");

/** Ids of the images the model was shown with this question. */
export const selectSeen = (app: AppState): string[] =>
  activeDoc(app).attachments.map((a) => a.digest);

/** Every root the thread holds — the brief's own, each exchange's, a live
 *  ask's — so an `attachment://` citation resolves against digests the view
 *  already knows and nothing else. */
export const selectThreadDigests = (app: AppState): string[] => {
  const doc = activeDoc(app);
  return [...new Set([
    ...doc.attachments.map((a) => a.digest),
    ...doc.exchanges.flatMap((x) => x.attachments),
    ...doc.askAttachments,
  ])];
};

/** The run bar's one status word — a total table over the active document's
 *  phase; the picker reads the session's readiness. An in-flight ask means
 *  writing is happening UNDER the settled document. */
export const selectStatus = (app: AppState): string => {
  const running = runDoc(app);
  if (running === null && app.activeDocId === null) return app.session.phase === "boot" ? "Starting" : "Ready";
  // The word describes the running document while one runs: the bar's
  // controls command that document, whatever the canvas shows.
  const d = running ?? activeDoc(app);
  return d.ask !== null ? "Writing" : PHASES[d.phase].status;
};

/** A follow-up ask is in flight — writing under the settled document. */
export const selectAskInFlight = (app: AppState): boolean => activeDoc(app).ask !== null;

/** The synth stream leaks its think block into the same buffer — only the
 *  close marker survives. While the think is open the text is deliberation,
 *  never answer prose; finalized answers strip through the last marker. */
export const splitThink = (
  text: string,
  streaming: boolean,
): { thinking: string | null; body: string } => {
  const close = text.lastIndexOf("</think>");
  if (close !== -1) {
    const thinking = text.slice(0, close).replace(/^<think>\s*/, "").trim();
    return {
      thinking: thinking || null,
      body: text.slice(close + "</think>".length).replace(/^\s+/, ""),
    };
  }
  return streaming ? { thinking: text, body: "" } : { thinking: null, body: text };
};

export interface Answer {
  thinking: string | null;
  body: string;
  streaming: boolean;
}

/** The canvas's document identity — the route mirrors this. */
export const selectActiveDocId = (app: AppState): string | null => app.activeDocId;

/** The ACTIVE doc's banked time — pace recording reads the settled doc. */
export const selectBankedActive = (app: AppState): number =>
  activeDoc(app).pipelineElapsedMs;

export interface RunControls {
  paused: boolean;
  closing: boolean;
}

/** The controls command the RUNNING document — `live` (which gates them) reads
 *  the same one, so Hold never sends `pause` for a run that is already paused
 *  because the canvas happened to show a settled brief. */
export const selectControls = (app: AppState): RunControls => {
  const d = runDoc(app) ?? activeDoc(app);
  return { paused: d.paused, closing: d.closing };
};

/** Remaining time against the machine's pace — null until the plan gives
 *  a task count. Past the estimate it says so instead of pretending to
 *  wrap. Pure: pace arrives as an argument. */
export interface Eta { label: string; fraction: number }

export const etaOf = (
  pace: Pace,
  tasks: number | null,
  elapsedMs: number,
): Eta | null => {
  if (tasks === null || tasks < 1) return null;
  const total = pace.perTaskMs * tasks + pace.synthMs;
  const left = total - elapsedMs;
  const label =
    left > 90_000 ? `about ${Math.round(left / 60_000)} minutes left`
    : left > 20_000 ? "under a minute left"
    : left > -30_000 ? "wrapping up"
    : "taking longer than usual";
  return { label, fraction: Math.min(1, Math.max(0, elapsedMs / total)) };
};

export const fmtBytes = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;

export const fmtElapsed = (ms: number): string => {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
