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

export const selectMoment = (app: AppState): Moment => MOMENT_OF[app.uiPhase];

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

/** Depth, in the product's voice — effort labeled by what it costs. */
export const DEPTHS: readonly { depth: Depth; label: string }[] = [
  { depth: "low", label: "Quick · 1 min" },
  { depth: "medium", label: "Standard · 3 min" },
  { depth: "high", label: "Thorough · 6 min" },
];

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
  ({
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
