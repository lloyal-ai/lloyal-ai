/** The domain seam. Everything above this file speaks the brief's language —
 *  Brief, Section, Inquiry, Outline — and everything below it is `AppState`,
 *  the one fold every target shares. Each selector is a pure derivation;
 *  nothing here is stored, dispatched, or fetched. */
import {
  extractStreamingReport,
  type AppState,
  type AgentRuntime,
  type TimelineItem,
} from "../../harness/state.js";
import { EFFORT_PRESETS } from "../../harness/effort-presets.js";

// ── moments ──────────────────────────────────────────────────────

/** Which moment owns the canvas. Boot states render inside Ask. */
export type Moment = "ask" | "frame" | "write" | "settle";

const MOMENT_OF: Record<AppState["uiPhase"], Moment> = {
  boot: "ask",
  downloading: "ask",
  loading: "ask",
  boot_error: "ask",
  backend_pack_offer: "ask",
  composer: "ask",
  discovering: "frame",
  planning: "frame",
  plan_review: "frame",
  clarifying: "frame",
  research: "write",
  done: "settle",
};

/** After the answer lands the harness returns to `composer` for the next
 *  query — but the settled brief IS the document, so it keeps the canvas
 *  until a new query resets the fold. */
export const selectMoment = (app: AppState): Moment => {
  const moment = MOMENT_OF[app.uiPhase];
  return moment === "ask" && app.answer ? "settle" : moment;
};

/** The tab dot and the run-state lamp: work is actually in progress. */
export const selectLive = (app: AppState): boolean =>
  app.uiPhase === "discovering" ||
  app.uiPhase === "planning" ||
  app.uiPhase === "research";

// ── ask ──────────────────────────────────────────────────────────

/** One knowledge source the brief can draw on, for the Ask byline. */
export interface Library {
  title: string;
  detail: string | null;
}

/** Library names in the product's voice; anything unlisted keeps its
 *  catalog title. */
const LIBRARY_NAMES: Record<string, string> = {
  web: "the web",
  corpus: "your corpus",
  wikipedia: "Wikipedia",
};

export const selectLibraries = (app: AppState): Library[] =>
  app.abilities
    .filter((a) => a.enabled && app.participation[a.name] !== false)
    .map((a) => ({
      title: LIBRARY_NAMES[a.name] ?? a.title,
      detail:
        a.name === "corpus" && app.corpusStatus
          ? `${app.corpusStatus.fileCount} files`
          : null,
    }));

export type Depth = "low" | "medium" | "high" | "ultra";

/** Depth, in the product's voice — the minutes are priced per plan by
 *  `estimateLabel`, never flat. */
export const DEPTHS: readonly { depth: Depth; title: string }[] = [
  { depth: "low", title: "Quick" },
  { depth: "medium", title: "Standard" },
  { depth: "high", title: "Thorough" },
];

/** Minutes for the picker, quoted ONLY from this machine's observed pace
 *  (`paceOf` — null until a brief of this depth and shape has settled).
 *  No plan yet → the preset's own breadth. Pure: pace arrives as an
 *  argument so the seam stays derivation-only. */
export const estimateLabel = (
  depth: Depth,
  tasks: number | null,
  perTaskMs: number | null,
): string | null => {
  if (perTaskMs === null) return null;
  const n = tasks ?? EFFORT_PRESETS[depth].maxTasks;
  return `~${Math.max(1, Math.round((perTaskMs * n) / 60_000))} min`;
};

export const selectTaskCount = (app: AppState): number | null =>
  app.plan?.tasks.length ?? null;

/** Wall time the run has actually spent (paused spans excluded). */
export const selectElapsed = (app: AppState): number =>
  app.pipelineElapsedMs +
  (app.pipelineResumedAt !== null ? Date.now() - app.pipelineResumedAt : 0);

export const selectDepth = (app: AppState): Depth =>
  (app.config?.defaults.effort ?? "high") as Depth;

/** The two plan shapes, as document characters (flat/deep stay wire-only). */
export type Shape = "survey" | "investigation";

export const SHAPES: readonly {
  shape: Shape;
  mode: "flat" | "deep";
  title: string;
  detail: string;
}[] = [
  { shape: "investigation", mode: "deep", title: "Investigation", detail: "each step builds on the last" },
  { shape: "survey", mode: "flat", title: "Survey", detail: "independent lenses, side by side" },
];

export const selectShape = (app: AppState): Shape =>
  (app.config?.defaults.reasoningMode ?? "flat") === "deep" ? "investigation" : "survey";

/** The shape of the run in flight (the submitted mode), not the config
 *  default — the pace record and the eta both speak about THIS run. */
export const selectRunShape = (app: AppState): Shape =>
  app.mode === "deep" ? "investigation" : "survey";

// ── boot, rendered in the shell's voice ──────────────────────────

export interface BootProgress {
  label: string;
  got: number;
  total: number;
  active: boolean;
}

export interface Boot {
  state: "quiet" | "downloading" | "loading" | "offer" | "error";
  downloads: BootProgress[];
  loadingLabel: string | null;
  offer: AppState["backendPackOffer"];
  error: AppState["bootError"];
}

export const selectBoot = (app: AppState): Boot => ({
  state:
    app.uiPhase === "downloading" ? "downloading"
    : app.uiPhase === "loading" ? "loading"
    : app.uiPhase === "backend_pack_offer" ? "offer"
    : app.uiPhase === "boot_error" ? "error"
    : "quiet",
  downloads: app.downloads.map((d) => ({
    label: d.label,
    got: d.got,
    total: d.total,
    active: d.started && !d.done,
  })),
  loadingLabel: app.loadingLabel,
  offer: app.backendPackOffer,
  error: app.bootError,
});

// ── the brief ────────────────────────────────────────────────────

export const selectTitle = (app: AppState): string =>
  app.query.replace(/\?\s*$/, "");

/** The run bar's one status word. */
export const selectStatus = (app: AppState): string =>
  selectMoment(app) === "settle" ? "Settled" : ({
    boot: "Starting",
    downloading: "Fetching the model",
    loading: "Loading",
    boot_error: "Stopped",
    backend_pack_offer: "Ready",
    composer: "Ready",
    discovering: "Checking your libraries",
    planning: "Framing",
    plan_review: "Framing",
    clarifying: "Framing",
    research: "Writing",
    done: "Settled",
  })[app.uiPhase];

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
  if (app.uiPhase !== "planning") return null;
  const planner = [...app.agents.values()].find((a) => a.endedAt === null);
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
  app.plan?.tasks.map((t) => t.description) ?? [];

export const selectReviewing = (app: AppState): boolean =>
  app.uiPhase === "plan_review";

/** The planner's questions, when it needs the user before framing. */
export const selectClarify = (app: AppState): string[] =>
  app.uiPhase === "clarifying" ? (app.plan?.clarifyQuestions ?? []) : [];

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
 *  finalized text, else the most recent settled synth body. */
export const selectAnswer = (app: AppState): Answer | null => {
  if (app.synth.open && app.synth.buffer) {
    return { ...splitThink(app.synth.buffer, true), streaming: true };
  }
  const settled = [...app.scrollback].reverse().find((s) => s.kind === "synth");
  const text = app.answer ?? (settled?.kind === "synth" ? settled.body : "");
  return text ? { ...splitThink(text, false), streaming: false } : null;
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
  /** The section's prose: the inquiry's report (draft) — streaming while
   *  it writes, settled when it lands. Already inline-cited by the weave. */
  prose: string | null;
  streaming: boolean;
}

/** A short head lifted from the task sentence: the text before the first
 *  " — ", clipped as a title. The full task stays as the tooltip. */
const sectionTitle = (task: string): string => {
  const head = task.split(" — ")[0];
  return head.length > 72 ? `${head.slice(0, 69)}…` : head;
};

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
  for (const a of app.agents.values()) if (a.taskIndex === index) return a;
  for (const s of app.scrollback) {
    if (s.kind === "agent" && s.agent.taskIndex === index) return s.agent;
  }
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
  (app.plan?.tasks ?? []).map((task, index) => {
    const a = agentForTask(app, index);
    const { prose, streaming } = a ? proseOf(a) : { prose: null, streaming: false };
    return {
      index,
      title: sectionTitle(task.description),
      task: task.description,
      inherits: app.mode === "deep" && index > 0,
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
 *  order — the rail and the document cannot disagree. Fences are skipped;
 *  inline markup is stripped from the shown text. */
export const anchorsOf = (
  markdown: string,
  prefix: string,
): { anchor: string; text: string; depth: number }[] => {
  const out: { anchor: string; text: string; depth: number }[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
    out.push({ anchor: `${prefix}-${slugify(text)}`, text, depth: m[1].length });
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
    const body = selectAnswer(app)?.body;
    return body
      ? anchorsOf(body, "a").map((h): OutlineEntry => ({
          anchor: h.anchor, text: h.text, level: railLevel(h.depth), index: 0,
        }))
      : [];
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

const agentById = (app: AppState, id: number): AgentRuntime | null => {
  const live = app.agents.get(id);
  if (live) return live;
  for (const s of app.scrollback) {
    if (s.kind === "agent" && s.agent.id === id) return s.agent;
  }
  return null;
};

const workSelectors = new Map<number, (app: AppState) => WorkStep[]>();

/** A stable selector per inquiry (`useBrief` memoizes by selector identity):
 *  the whole stream, ready to disclose — thoughts as the fold parsed them,
 *  calls and results in the librarian's verbs, and the raw token tail while
 *  the model writes its next move. The report tail is omitted: it is already
 *  streaming in place as the section's prose. */
export const selectWorkFor = (id: number): ((app: AppState) => WorkStep[]) => {
  const cached = workSelectors.get(id);
  if (cached) return cached;
  const select = (app: AppState): WorkStep[] => {
    const a = agentById(app, id);
    if (!a) return [];
    const steps = a.timeline
      .map(stepOf)
      .filter((s): s is WorkStep => s !== null);
    if (a.phase !== "done" && a.contentBuffer && liveProse(a) === null) {
      steps.push({ kind: "tokens", text: a.contentBuffer, live: true });
    }
    return steps;
  };
  workSelectors.set(id, select);
  return select;
};

/** The settling pass: after the inquiries, the brief is edited into one
 *  voice — the synth stream, deliberation split out. */
export const selectSettling = (app: AppState): Answer | null =>
  app.phase === "synth" && app.synth.open && app.synth.buffer
    ? { ...splitThink(app.synth.buffer, true), streaming: true }
    : null;

// ── run controls ─────────────────────────────────────────────────

export interface RunControls {
  paused: boolean;
  closing: boolean;
}

export const selectControls = (app: AppState): RunControls => ({
  paused: app.paused,
  closing: app.closing,
});

/** Remaining time against this machine's observed pace — null when no pace
 *  is known yet (the clock alone is honest then). Past the estimate it says
 *  so instead of pretending to wrap. Pure: pace arrives as an argument. */
export interface Eta { label: string; fraction: number }

export const etaOf = (
  perTaskMs: number | null,
  tasks: number | null,
  elapsedMs: number,
): Eta | null => {
  if (perTaskMs === null || tasks === null || tasks < 1) return null;
  const total = perTaskMs * tasks;
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
