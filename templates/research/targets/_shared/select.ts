/** The domain seam. Everything above this file speaks the brief's language —
 *  Brief, Section, Inquiry, Outline — and everything below it is `AppState`,
 *  the one fold every target shares. Each selector is a pure derivation;
 *  nothing here is stored, dispatched, or fetched. */
import {
  extractStreamingReport,
  type AppState,
  type DocState,
  type DocPhase,
  type AgentRuntime,
  type TimelineItem,
} from "../../harness/state.js";
import { EFFORT_PRESETS } from "../../harness/effort-presets.js";
import type { Pace } from "./pace.js";

// ── moments ──────────────────────────────────────────────────────

/** Which moment owns the canvas. Boot states render inside Ask. */
export type Moment = "ask" | "frame" | "write" | "settle";

/** The empty document — a VALUE, not a null-check. Selectors stay total:
 *  with no active document they derive from this and return their natural
 *  empties. Frozen so nothing can turn it into a place. */
const EMPTY_DOC: DocState = Object.freeze({
  id: "",
  query: "",
  attachments: [],
  mode: null,
  direct: false,
  runEffort: null,
  phase: "done",
  plan: null,
  agents: new Map(),
  researchAgentIds: [],
  reconAgentIds: [],
  waitingTaskIndices: [],
  pendingTaskIndex: null,
  pendingTaskDescription: null,
  researchSpawnCount: 0,
  researchAgentCount: 0,
  nextTimelineId: 0,
  nextLabelIdx: 0,
  synth: { open: false, buffer: "", done: false, stats: null },
  answer: null,
  exchanges: [],
  ask: null,
  askAttachments: [],
  paused: false,
  closing: false,
  closedEarly: false,
  pipelineElapsedMs: 0,
  pipelineResumedAt: null,
}) as DocState;

/** The document the canvas shows; EMPTY_DOC at the picker. */
const activeDoc = (app: AppState): DocState =>
  (app.activeDocId !== null ? app.documents.get(app.activeDocId) : undefined) ?? EMPTY_DOC;

/** The document the live run writes into; null when no run. */
const runDoc = (app: AppState): DocState | null =>
  app.runDocId !== null ? app.documents.get(app.runDocId) ?? null : null;


const MOMENT_OF: Record<DocPhase, Moment> = {
  planning: "frame",
  discovering: "frame",
  clarifying: "frame",
  plan_review: "frame",
  research: "write",
  synthesizing: "write",
  done: "settle",
};

/** The canvas moment: a total table over the active document's phase. No
 *  overrides — an in-flight ask never leaves 'done' by construction (the
 *  rule lives in the fold), and the picker IS the absence of a doc. */
export const selectMoment = (app: AppState): Moment =>
  app.activeDocId === null ? "ask" : MOMENT_OF[activeDoc(app).phase];

const LIVE_PHASES: ReadonlySet<DocPhase> = new Set([
  "discovering", "planning", "research", "synthesizing",
]);

/** The tab dot and the run-state lamp: work in progress ANYWHERE — a
 *  session truth, read off the run's document wherever the canvas is. */
export const selectLive = (app: AppState): boolean => {
  const d = runDoc(app);
  return d !== null && (LIVE_PHASES.has(d.phase) || d.ask !== null);
};

// ── ask ──────────────────────────────────────────────────────────

/** One knowledge source the brief can draw on. `included` mirrors the
 *  per-query participation bit — the Ask byline's names toggle it. */
export interface Library {
  name: string;
  title: string;
  detail: string | null;
  included: boolean;
  /** The ability's own mark, when its manifest names one. */
  iconUrl?: string;
  /** In the registry — its factory ran, so it can actually be drawn on. */
  enabled: boolean;
  /** Required config keys with no stored value. Non-empty ⇒ the ability is
   *  installed but cannot be enabled until they are set, which is a different
   *  thing from a user having excluded it. */
  needs: string[];
  /** Its config surface, derived from the ability's OWN schema — nothing here
   *  knows what a corpus or an API key is, which is what lets a harness render
   *  config for an ability it has never seen. */
  fields: AbilityField[];
}

export interface AbilityField {
  key: string;
  /** JSON Schema type; decides the input. */
  type: string;
  required: boolean;
  /** `x-secret` — write-only. Never rendered, only replaced. */
  secret: boolean;
  /** A value is stored. Key-presence only: the value never leaves the host,
   *  so the form can say "stored" but can never show it. */
  set: boolean;
}

type ConfigSchema = {
  properties?: Record<string, { type?: string; "x-secret"?: boolean } | undefined>;
  required?: string[];
};

const fieldsOf = (
  schema: unknown,
  config: Record<string, unknown>,
): AbilityField[] => {
  const s = schema as ConfigSchema | undefined;
  const required = new Set(s?.required ?? []);
  return Object.entries(s?.properties ?? {}).map(([key, prop]) => ({
    key,
    type: typeof prop?.type === "string" ? prop.type : "string",
    required: required.has(key),
    secret: prop?.["x-secret"] === true,
    set: key in config,
  }));
};

/** EVERY installed ability — see the wire notes on abilities:state. */
export const selectLibraries = (app: AppState): Library[] =>
  app.session.abilities
    .map((a) => ({
      name: a.name,
      // The ability's own name — as a chip beside its siblings the bare
      // name is what identifies it, and it stays true for an ability this
      // harness has never heard of.
      title: a.name,
      detail:
        a.name === "corpus" && app.session.corpusStatus
          ? `${app.session.corpusStatus.fileCount} files`
          : null,
      included: app.session.participation[a.name] !== false,
      iconUrl: a.iconUrl,
      enabled: a.enabled,
      needs: ((a.configSchema as { required?: string[] } | undefined)?.required ?? [])
        .filter((k) => !(k in a.config)),
      fields: fieldsOf(a.configSchema, a.config),
    }));

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

export type Depth = "low" | "medium" | "high" | "ultra";

/** Depth, in the product's voice — the minutes are priced per plan by
 *  `estimateLabel`, never flat. */
export const DEPTHS: readonly { depth: Depth; title: string }[] = [
  { depth: "low", title: "Quick" },
  { depth: "medium", title: "Standard" },
  { depth: "high", title: "Thorough" },
];

/** Minutes for the picker, from the machine's pace (`paceFor` — a stated
 *  prior until a brief of this depth and shape has settled): inquiries at
 *  the per-task rate plus the settling pass. The plan's task count is
 *  clamped to each depth's own breadth — a depth never quotes more
 *  inquiries than it would actually run. No plan yet → the preset's
 *  breadth. Pure: pace arrives as an argument so the seam stays
 *  derivation-only. */
export const estimateLabel = (depth: Depth, tasks: number | null, pace: Pace): string => {
  const breadth = EFFORT_PRESETS[depth].maxTasks;
  const n = Math.min(tasks ?? breadth, breadth);
  return `~${Math.max(1, Math.round((pace.perTaskMs * n + pace.synthMs) / 60_000))} min`;
};

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

export const selectDepth = (app: AppState): Depth =>
  (app.session.config?.defaults.effort ?? "high") as Depth;

/** The RUNNING run's depth. The config default can be retoggled mid-run
 *  (that is what the depth chips edit); time math keys off the effort the
 *  run was actually submitted at. */
export const depthOf = (app: AppState, d: DocState): Depth =>
  (d.runEffort ?? app.session.config?.defaults.effort ?? "high") as Depth;
export const selectRunDepth = (app: AppState): Depth => depthOf(app, runDoc(app) ?? activeDoc(app));

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

/** How a brief is worked, as document characters (flat/deep stay wire-only).
 *  `ask` is not a plan shape at all — it skips the planner and puts ONE agent
 *  over every ability, which is why it carries `direct` rather than a mode of
 *  its own. It rides `flat` on the wire because a single task has no order to
 *  disagree about. */
export type Shape = "survey" | "investigate" | "ask";

export const SHAPES: readonly {
  shape: Shape;
  mode: "flat" | "deep";
  /** Skips the planner: the question IS the plan. */
  direct?: boolean;
  title: string;
  detail: string;
}[] = [
  // Ordered by what they cost the reader: one answer, then several lenses at
  // once, then a chain that builds. Nothing indexes this table — the order is
  // the picker's reading order and nothing else.
  { shape: "ask", mode: "flat", direct: true, title: "Ask", detail: "one agent, every ability — straight answer" },
  { shape: "survey", mode: "flat", title: "Survey", detail: "independent lenses, side by side" },
  { shape: "investigate", mode: "deep", title: "Investigate", detail: "each step builds on the last" },
];

/** The configured default. Only a plan shape can be a default: `reasoningMode`
 *  has no value for `ask`, which is chosen per run and never persisted. */
export const selectShape = (app: AppState): Shape =>
  (app.session.config?.defaults.reasoningMode ?? "flat") === "deep" ? "investigate" : "survey";

/** The shape of the run in flight (the submitted mode), not the config
 *  default — the pace record and the eta both speak about THIS run. A direct
 *  run rides `flat`, so the mode alone would call an ask a Survey. */
export const shapeOf = (d: DocState): Shape =>
  d.direct ? "ask" : d.mode === "deep" ? "investigate" : "survey";
export const selectRunShape = (app: AppState): Shape => shapeOf(runDoc(app) ?? activeDoc(app));

/** The document the live run writes into; null when no run. */
export const selectRunDocId = (app: AppState): AppState["runDocId"] => app.runDocId;

// ── boot, rendered in the shell's voice ──────────────────────────

export interface Boot {
  state: "quiet" | "loading";
  loadingLabel: string | null;
}

export const selectBoot = (app: AppState): Boot => ({
  state: app.session.phase === "boot" && app.session.loadingLabel !== null ? "loading" : "quiet",
  loadingLabel: app.session.loadingLabel,
});

// ── the brief ────────────────────────────────────────────────────

export const selectTitle = (app: AppState): string =>
  activeDoc(app).query.replace(/\?\s*$/, "");

/** Ids of the images the model was shown with this question. */
export const selectSeen = (app: AppState): string[] =>
  activeDoc(app).attachments.map((a) => a.digest);

const STATUS_OF: Record<DocPhase, string> = {
  planning: "Framing",
  discovering: "Browsing your sources",
  clarifying: "Framing",
  plan_review: "Framing",
  research: "Writing",
  synthesizing: "Writing",
  done: "Settled",
};

/** The run bar's one status word — a total table over the active document's
 *  phase; the picker reads the session's readiness. An in-flight ask means
 *  writing is happening UNDER the settled document. */
export const selectStatus = (app: AppState): string => {
  if (app.activeDocId === null) return app.session.phase === "boot" ? "Starting" : "Ready";
  const d = activeDoc(app);
  return d.ask !== null ? "Writing" : STATUS_OF[d.phase];
};

/** The outline as the planner drafts it, live — complete `"description"`
 *  strings lifted from the grammar-forced JSON stream, plus the trailing
 *  partial under the caret. The planner is the one agent alive while
 *  `planning`; its tokens accumulate in the live think body (the plan
 *  grammar emits no think markers) and the content buffer. */
export interface OutlineDraft {
  settled: string[];
  partial: string | null;
}

const DESC_COMPLETE = /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const DESC_PARTIAL = /"description"\s*:\s*"((?:[^"\\]|\\.)*)$/;
const unescape = (raw: string): string => {
  try { return JSON.parse(`"${raw}"`) as string; } catch { return raw; }
};

export const selectOutlineDraft = (app: AppState): OutlineDraft | null => {
  if (activeDoc(app).phase !== "planning") return null;
  const planner = [...activeDoc(app).agents.values()].find((a) => a.endedAt === null);
  if (!planner) return { settled: [], partial: null };
  const think = planner.timeline.find(
    (t) => t.kind === "think" && t.id === planner.currentThinkId,
  );
  const buffer = (think?.kind === "think" ? think.body : "") + planner.contentBuffer;
  const settled = [...buffer.matchAll(DESC_COMPLETE)].map((m) => unescape(m[1]));
  const tail = buffer.match(DESC_PARTIAL);
  const partial = tail && !settled.includes(unescape(tail[1])) ? unescape(tail[1]) : null;
  return { settled, partial };
};

/** The settled plan, editable while the harness holds it for review. */
export const selectOutline = (app: AppState): string[] =>
  activeDoc(app).plan?.tasks.map((t) => t.description) ?? [];

export const selectReviewing = (app: AppState): boolean =>
  activeDoc(app).phase === "plan_review";

/** A follow-up ask is in flight — writing under the settled document. */
export const selectAskInFlight = (app: AppState): boolean => activeDoc(app).ask !== null;

/** The planner's questions, when it needs the user before framing. */
export const selectClarify = (app: AppState): string[] =>
  activeDoc(app).phase === "clarifying" ? (activeDoc(app).plan?.clarifyQuestions ?? []) : [];

/** The synth stream leaks its think block into the same buffer — only the
 *  close marker survives. While the think is open the text is deliberation,
 *  never answer prose; finalized answers strip through the last marker. */
const splitThink = (
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

/** The answer as it exists right now: the live synth stream, else the
 *  finalized text. Deliberately NOT scrollback — the session scrollback
 *  outlives the document, and reading it here would let one brief's prose
 *  render under another's title. */
export const selectAnswer = (app: AppState): Answer | null => {
  const d = activeDoc(app);
  if (d.synth.open && d.synth.buffer) {
    return { ...splitThink(d.synth.buffer, true), streaming: true };
  }
  return d.answer !== null ? { ...splitThink(d.answer, false), streaming: false } : null;
};

// ── the sections: watch it write ─────────────────────────────────

/** One step of an inquiry's activity, in the librarian's voice. */
export interface InquiryVerb {
  kind: "thinking" | "working" | "waiting" | "writing" | "settled" | "kept" | "failed";
  text: string;
  /** For "waiting": when the retry fires (ms epoch), for the countdown. */
  retryAt?: number;
}

export interface Inquiry {
  /** Stable identity shared with the dev pane's lanes. */
  id: number;
  index: number;
  verb: InquiryVerb;
  startedAt: number;
  endedAt: number | null;
}

export interface Section {
  index: number;
  title: string;
  task: string;
  /** Deep mode: this section opens from its predecessors' findings. */
  inherits: boolean;
  inquiry: Inquiry | null;
  /** Named by the plan, but no branch free yet — `nSeqMax` is a hard
   *  reservation, so a wide plan forks in waves. True only while queued;
   *  the section head wears a clock until its inquiry starts. */
  waiting: boolean;
  /** The section's prose: the inquiry's report (draft) — streaming while
   *  it writes, settled when it lands. Already inline-cited by the weave. */
  prose: string | null;
  streaming: boolean;
}

/** The section head IS the task, whole — the reader always sees exactly
 *  what its inquiry is answering. Long heads wrap; the rail ellipsizes. */
const sectionTitle = (task: string): string => task;

const TOOL_DOING: Record<string, string> = {
  web_search: "Searching",
  fetch_page: "Reading",
  search: "Searching",
};
const TOOL_DONE: Record<string, string> = {
  web_search: "Searched",
  fetch_page: "Read",
  search: "Searched",
};
const doing = (tool: string): string =>
  TOOL_DOING[tool] ?? (/search/i.test(tool) ? "Searching" : "Reading");
const doneVerb = (tool: string): string =>
  TOOL_DONE[tool] ?? (/search/i.test(tool) ? "Searched" : "Read");

const resultMeta = (t: Extract<TimelineItem, { kind: "tool_result" }>): string => {
  const meta = t.resultCount != null
    ? `${t.resultCount} results`
    : `${(t.byteLength / 1000).toFixed(1)} kb`;
  return `${doneVerb(t.tool)} — ${meta}${t.hosts[0] ? ` · ${t.hosts[0]}` : ""}`;
};

/** The live report stream, extracted through the terminal tool's envelope
 *  once it opens — recovery streams re-emit the envelope too, so it is never
 *  rendered. A recovery stream that never opens one is bare prose; leading
 *  tag fragments are held back until real text arrives. */
const liveProse = (a: AgentRuntime): string | null => {
  const report = extractStreamingReport(a.contentBuffer);
  if (report !== null) return report;
  if (!a.recovering) return null;
  return a.contentBuffer.replace(/^(?:\s*<[^>\n]*>?\n?)*/, "") || null;
};

/** The report body may arrive as the report tool's raw JSON argument —
 *  unwrap `.result` only when parsing yields exactly that shape. */
const reportBody = (body: string): string => {
  if (body.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as { result?: unknown };
      if (typeof parsed?.result === "string") return parsed.result;
    } catch { /* raw markdown */ }
  }
  return body;
};

const agentForTask = (app: AppState, index: number): AgentRuntime | null => {
  for (const a of activeDoc(app).agents.values()) if (a.taskIndex === index) return a;
  return null;
};

/** Failure, in the librarian's voice. Unlisted reasons are mechanical
 *  (decode errors) — the dev pane keeps the detail. */
const FAIL_TEXT: Record<string, string> = {
  user_cancel: "dropped — left out of the brief",
  time_exceeded: "out of time — kept what it had",
  wind_down: "closed early — kept what it had",
};
const failText = (reason: string): string =>
  FAIL_TEXT[reason] ?? "couldn't finish this line of inquiry";

const verbOf = (a: AgentRuntime): InquiryVerb => {
  if (a.failReason) return { kind: "failed", text: failText(a.failReason) };
  if (a.phase === "done") {
    const kept = a.timeline.some((t) => t.kind === "report");
    return kept
      ? { kind: "settled", text: "wrote its section" }
      : { kind: "kept", text: "kept what it had" };
  }
  if (a.retry) {
    return {
      kind: "waiting",
      text: `${a.retry.tool.replace(/_/g, " ")} is rate-limited`,
      retryAt: a.retry.retryAt,
    };
  }
  if (a.recovering || liveProse(a) !== null) {
    return { kind: "writing", text: "settling the section into the brief" };
  }
  const lastCall = [...a.timeline].reverse().find((t) => t.kind === "tool_call");
  if (lastCall?.kind === "tool_call" && a.pendingToolCallId === lastCall.id) {
    return { kind: "working", text: `${doing(lastCall.tool)} — ${lastCall.argsSummary}` };
  }
  const lastResult = [...a.timeline].reverse().find((t) => t.kind === "tool_result");
  if (lastResult?.kind === "tool_result") {
    return { kind: "working", text: resultMeta(lastResult) };
  }
  return { kind: "thinking", text: "thinking it through" };
};

const proseOf = (a: AgentRuntime): { prose: string | null; streaming: boolean } => {
  const report = [...a.timeline].reverse().find((t) => t.kind === "report");
  if (report?.kind === "report") return { prose: reportBody(report.body), streaming: false };
  const live = a.phase !== "done" ? liveProse(a) : null;
  return live ? { prose: live, streaming: true } : { prose: null, streaming: false };
};

export const selectSections = (app: AppState): Section[] =>
  (activeDoc(app).plan?.tasks ?? []).map((task, index) => {
    const a = agentForTask(app, index);
    const { prose, streaming } = a ? proseOf(a) : { prose: null, streaming: false };
    return {
      index,
      title: sectionTitle(task.description),
      task: task.description,
      inherits: activeDoc(app).mode === "deep" && index > 0,
      waiting: !a && activeDoc(app).waitingTaskIndices.includes(index),
      inquiry: a && {
        id: a.id,
        index,
        verb: verbOf(a),
        startedAt: a.startedAt,
        endedAt: a.endedAt,
      },
      prose,
      streaming,
    };
  });

// ── the library ──────────────────────────────────────────────────

export interface ReportEntry {
  path: string;
  /** The identity — keys the route, the fold, and the run-dir. */
  docId: string;
  title: string;
  savedAt: string;
  mode: "flat" | "deep" | null;
  hasMedia: boolean;
}

/** Every settled brief on disk, newest first. Opening one restores it as
 *  the session document — no body is ever held view-side. */
export const selectLibrary = (app: AppState): ReportEntry[] => app.session.library.entries;

/** The live library search, when one is running: its query and the report
 *  paths ranked best-first by the session reranker. */
export const selectLibrarySearch = (app: AppState): { query: string; ranked: string[] } | null =>
  app.session.librarySearch;

// ── the settled document ─────────────────────────────────────────

export interface Citation {
  ordinal: number;
  title: string;
  url: string;
  host: string;
  cited: number;
}

// Any link target counts as a citation — the weave cites web urls and
// corpus file paths alike; a non-url target IS a corpus file.
const MD_LINK = /\[([^\]]+)\]\(([^\s)]+)\)/g;
const BARE_ORDINAL = /^\[?\d+\]?$/;

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "your corpus"; }
};

/** Numbered chips, derived from the woven answer alone — links in first-
 *  appearance order, one ordinal per url, repeats collapsed into `cited`.
 *  A bare "[1]"-style link keeps its slot but takes a real title from any
 *  later appearance. Never re-weaves. */
export const selectCitations = (app: AppState): Citation[] => {
  const body = selectAnswer(app)?.body ?? "";
  const byUrl = new Map<string, Citation>();
  for (const m of body.matchAll(MD_LINK)) {
    const [, title, url] = m;
    const seen = byUrl.get(url);
    if (seen) {
      seen.cited += 1;
      if (BARE_ORDINAL.test(seen.title) && !BARE_ORDINAL.test(title)) seen.title = title;
      continue;
    }
    byUrl.set(url, { ordinal: byUrl.size + 1, title, url, host: hostOf(url), cited: 1 });
  }
  return [...byUrl.values()];
};

/** The weave (and the synth) end the document with a bare source list —
 *  the sources grid replaces it, so the prose sheds it. Anything that
 *  doesn't match the trailing-list shape is left alone. */
const TRAILING_SOURCES =
  /\n(?:#{1,4}\s+|\*\*)?(?:sources|references)(?:\*\*)?\s*:?\s*\n(?:\s*(?:[-*]|\d+\.)?\s*\[[^\]]*\]\([^)]*\)[^\n]*\n?)+\s*$/i;

export const selectSettleProse = (app: AppState): string =>
  (selectAnswer(app)?.body ?? "").replace(TRAILING_SOURCES, "").trimEnd();

/** Structural margin marks — facts of the run, never judgments of the
 *  content: how it ended, how much it rests on, what closed unsettled. */
export const selectMarks = (app: AppState): string[] => {
  const marks: string[] = [];
  if (activeDoc(app).closedEarly) marks.push("Closed early — settled with what it had.");
  const cited = selectCitations(app).length;
  if (cited === 1) marks.push("Rests on one source — read it before you lean on it.");
  else if (cited === 2) marks.push("Rests on two sources.");
  let unsettled = 0;
  for (const a of activeDoc(app).agents.values()) if (a.failReason !== null && a.taskIndex !== null) unsettled += 1;
  if (unsettled === 1) marks.push("One line of inquiry closed without settling.");
  else if (unsettled > 1) marks.push(`${unsettled} lines of inquiry closed without settling.`);
  return marks;
};

/** One pre-flight probe: a library answering "what do you hold on this?"
 *  before anything is planned. */
export interface Probe {
  title: string;
  inquiry: Inquiry;
  /** Searches the probe has made so far. */
  searches: number;
  /** Results those searches surfaced (null until any land). */
  found: number | null;
  /** The latest visible beat — a thought's title or the last result line —
   *  so the card always shows motion at edge token rates. */
  peek: string | null;
}

/** The pre-flight probes — one recon agent per included library, aligned by
 *  spawn order (the pool forks them in the byline's own order). The Frame
 *  stacks them full-width like every other section; each carries the full
 *  disclosure stream research rows have. */
export const selectProbes = (app: AppState): Probe[] => {
  const included = selectLibraries(app).filter((l) => l.included);
  const out: Probe[] = [];
  activeDoc(app).reconAgentIds.forEach((id, i) => {
    const a = activeDoc(app).agents.get(id);
    if (!a) return;
    let searches = 0;
    let found: number | null = null;
    for (const t of a.timeline) {
      if (t.kind === "tool_call") searches += 1;
      if (t.kind === "tool_result" && t.resultCount !== null) {
        found = (found ?? 0) + t.resultCount;
      }
    }
    const last = a.timeline[a.timeline.length - 1];
    const peek =
      last === undefined ? null
      : last.kind === "think" ? (last.live && last.title === "Thinking…" ? null : last.title)
      : last.kind === "tool_call" ? `${doing(last.tool)} ${last.argsSummary}`.trim()
      : last.kind === "tool_result" ? resultMeta(last)
      : null;
    out.push({
      title: included[i]?.title ?? "a source",
      inquiry: { id: a.id, index: i, verb: verbOf(a), startedAt: a.startedAt, endedAt: a.endedAt },
      searches,
      found,
      peek,
    });
  });
  return out;
};

/** The document's warm-ask exchanges, settled beneath it. */
/** Exchanges parsed the way the root answer is: deliberation split out behind
 *  its own disclosure, prose alone in the document. The fold keeps the RAW
 *  stream (the host is the author); the split is a view concern. */
export const selectExchanges = (
  app: AppState,
): { question: string; body: string; thinking: string | null; attachments: string[] }[] =>
  activeDoc(app).exchanges.map((x) => ({ question: x.question, attachments: x.attachments, ...splitThink(x.body, false) }));

/** The warm ask in flight: its question, whatever of its answer has
 *  streamed, and its worker as a full inquiry — verbs, park honesty, and
 *  the disclosure — numbered after the document's own inquiries. */
export const selectAsk = (
  app: AppState,
): { question: string; body: string; inquiry: Inquiry | null; attachments: string[] } | null => {
  const d = activeDoc(app);
  if (d.ask === null) return null;
  const index = (d.plan?.tasks.length ?? 0) + d.exchanges.length;
  for (const a of d.agents.values()) {
    if (a.endedAt === null) {
      return {
        question: d.ask,
        attachments: d.askAttachments,
        // While the think block is open the text is deliberation, never answer
        // prose — the row's verb already says "thinking it through".
        body: splitThink(liveProse(a) ?? "", true).body,
        inquiry: { id: a.id, index, verb: verbOf(a), startedAt: a.startedAt, endedAt: a.endedAt },
      };
    }
  }
  return { question: d.ask, body: "", inquiry: null, attachments: d.askAttachments };
};

/** What the run itself read about each source: the first snippet any tool
 *  result carried for a url, for the source cards. */
export const selectSourceNotes = (app: AppState): Map<string, string> => {
  const notes = new Map<string, string>();
  const harvest = (a: AgentRuntime): void => {
    for (const t of a.timeline) {
      if (t.kind !== "tool_result" || !t.sources) continue;
      for (const s of t.sources) {
        if (s.url && s.snippet && !notes.has(s.url)) notes.set(s.url, s.snippet);
      }
    }
  };
  for (const a of activeDoc(app).agents.values()) harvest(a);
  return notes;
};

// ── the floating outline ─────────────────────────────────────────

export interface OutlineEntry {
  anchor: string;
  text: string;
  /** 0 = a section (task); 1–2 = headings inside its prose. */
  level: 0 | 1 | 2;
  /** Owning section index, for identity color. */
  index: number;
}

const slugify = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "h";

/** Every markdown heading in document order, anchored under `prefix`.
 *  Pure and shared with `Prose`, which assigns these same ids in render
 *  order — the rail and the document cannot disagree. Repeated headings
 *  get numbered anchors so ids stay unique. Fences are skipped; inline
 *  markup is stripped from the shown text. */
export const anchorsOf = (
  markdown: string,
  prefix: string,
): { anchor: string; text: string; depth: number }[] => {
  const out: { anchor: string; text: string; depth: number }[] = [];
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
    const slug = slugify(text);
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    out.push({ anchor: `${prefix}-${slug}${n > 1 ? `-${n}` : ""}`, text, depth: m[1].length });
  }
  return out;
};

const railLevel = (depth: number): 1 | 2 => (depth <= 2 ? 1 : 2);

/** The rail: sections and the headings streaming into them while the brief
 *  writes; the settled answer's own headings once it lands. */
export const selectRail = (app: AppState): OutlineEntry[] => {
  const moment = selectMoment(app);
  if (moment === "write") {
    return selectSections(app).flatMap((s): OutlineEntry[] => [
      { anchor: `s${s.index}`, text: s.title, level: 0, index: s.index },
      ...(s.prose ? anchorsOf(s.prose, `s${s.index}`) : []).map((h): OutlineEntry => ({
        anchor: h.anchor, text: h.text, level: railLevel(h.depth), index: s.index,
      })),
    ]);
  }
  if (moment === "settle") {
    const body = selectSettleProse(app);
    if (!body) return [];
    const entries = anchorsOf(body, "a").map((h): OutlineEntry => ({
      anchor: h.anchor, text: h.text, level: railLevel(h.depth), index: 0,
    }));
    if (selectCitations(app).length > 0) {
      // The grid's own anchor lives outside the markdown `a-` namespace so a
      // report's "## Sources" heading can never collide with it.
      entries.push({ anchor: "grid-sources", text: "Sources", level: 1, index: 0 });
    }
    activeDoc(app).exchanges.forEach((x, i) => {
      // Each thread entry is its own document in the rail: the question heads
      // the group, and the answer's headings nest beneath it — an Extend's
      // full outline stands under its question, an Ask's short answer adds
      // nothing.
      entries.push({ anchor: `e${i}`, text: x.question, level: 0, index: i + 1 });
      anchorsOf(x.body, `e${i}`).forEach((h) => {
        entries.push({
          anchor: h.anchor, text: h.text, level: railLevel(h.depth), index: i + 1,
        });
      });
    });
    return entries;
  }
  return [];
};

// ── the disclosed work stream ────────────────────────────────────

/** One step of an inquiry's disclosed stream. `tokens` is the raw tail of
 *  the move being written — visible progress even at a few tokens a second. */
export interface WorkStep {
  kind: "thought" | "call" | "result" | "tokens";
  text: string;
  live: boolean;
}

const stepOf = (t: TimelineItem): WorkStep | null =>
  t.kind === "think" ? { kind: "thought", text: t.body, live: t.live }
  : t.kind === "tool_call" ? { kind: "call", text: `${doing(t.tool)} — ${t.argsSummary}`, live: false }
  : t.kind === "tool_result" ? { kind: "result", text: resultMeta(t), live: false }
  : null;

/** A selector FACTORY for one inquiry's disclosed stream — thoughts as the
 *  fold parsed them, calls and results in the librarian's verbs, and the raw
 *  token tail while the model writes its next move. The report tail is
 *  omitted: it is already streaming in place as the section's prose.
 *
 *  Pure factory: hold the result with `useMemo(() => selectWorkFor(id), [id])`
 *  — `useBrief` memoizes by selector identity, so the caller owns the
 *  identity for exactly as long as the inquiry renders. */
export const selectWorkFor = (id: number): ((app: AppState) => WorkStep[]) => {
  return (app: AppState): WorkStep[] => {
    const a = activeDoc(app).agents.get(id);
    if (!a) return [];
    const steps = a.timeline
      .map(stepOf)
      .filter((s): s is WorkStep => s !== null);
    if (a.phase !== "done" && a.contentBuffer && liveProse(a) === null) {
      steps.push({ kind: "tokens", text: a.contentBuffer, live: true });
    }
    return steps;
  };
};

/** The settling pass: after the inquiries, the brief is edited into one
 *  voice — the synth stream, deliberation split out. */
export const selectSettling = (app: AppState): Answer | null =>
  activeDoc(app).synth.open && activeDoc(app).synth.buffer
    ? { ...splitThink(activeDoc(app).synth.buffer, true), streaming: true }
    : null;

/** The canvas's document identity — the route mirrors this. */
export const selectActiveDocId = (app: AppState): string | null => app.activeDocId;

/** The Frame moment's recon gate. */
export const selectDiscovering = (app: AppState): boolean =>
  activeDoc(app).phase === "discovering";

/** The ACTIVE doc's banked time — pace recording reads the settled doc. */
export const selectBankedActive = (app: AppState): number =>
  activeDoc(app).pipelineElapsedMs;

// ── run controls ─────────────────────────────────────────────────

export interface RunControls {
  paused: boolean;
  closing: boolean;
}

export const selectControls = (app: AppState): RunControls => ({
  paused: activeDoc(app).paused,
  closing: activeDoc(app).closing,
});

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

// ── shared formatting ────────────────────────────────────────────

export const fmtBytes = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;

export const fmtElapsed = (ms: number): string => {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

// Re-exported so parts never import the fold module directly.
export { extractStreamingReport };
export type { AppState, AgentRuntime, TimelineItem };
