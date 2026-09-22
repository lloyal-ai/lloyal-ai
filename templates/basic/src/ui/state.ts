/**
 * How a view accumulates your events into renderable state: `reduce(state, event) → AppState`, a pure
 * node-free fold. Only the raw `WorkflowEvent` crosses a target boundary, never the growing transcript, so
 * the fold happens in the SINK — and all three views (Ink · desktop · web) import this one function.
 *
 * What each agent is DOING is `foldAgents`, ui's, which is what keeps the model's markup out of this app.
 * What the ARTICLES are is below it, and basic's own: it reads the tools' raw payloads, which a runtime
 * roster has no reason to keep.
 */
import { emptyRoster, foldAgents } from "@lloyal-labs/ui/fold";
import type { AgentRoster, AgentRuntime, AgentEvent as FoldableEvent } from "@lloyal-labs/ui/fold";
import { RIG_REPORT, taskIndexOf } from "@lloyal-labs/rig";
import type { WorkflowEvent, BootFacts, Group, KeptArticle } from "../protocol.js";

export type { AgentRoster, AgentRuntime, TimelineItem } from "@lloyal-labs/ui/fold";

export type Phase = "booting" | "ready" | "working" | "answered";

/** Human-readable file size. `sizeBytes` is best-effort — 0 means the stat failed. */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return "unknown";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

/** One article the model fetched — a card in the view (thumbnail optional). */
export interface WikiSource {
  title: string;
  snippet: string;
  url: string;
  thumbnail?: string;
}

export interface AppState {
  phase: Phase;
  /** Measured boot facts for the header — null until `ready` lands. */
  boot: BootFacts | null;
  /** What each agent is doing. Fresh per question: a roster is this turn's work, and the page the turn
   *  produced is the record of what came before it. */
  roster: AgentRoster;
  /** The Wikipedia articles the agents have READ, deduped, in first-seen order. */
  sources: WikiSource[];
  /** The distinct searches they ran, in first-seen order. */
  queries: string[];
  answer: string;
  /** The last turn ended with no article. Distinct from an empty `answer`: a follow-up that finds nothing
   *  leaves the previous article on screen, so the page alone cannot say it. */
  nothingFound: boolean;
  /** How many articles this session has accepted — what a surface counts when it shows each one once.
   *  Only an answer carrying an article advances it, so a stop and a follow-up that found nothing do not. */
  accepted: number;
  error: string | null;
  /** KV pressure for the gauge (from `agent:tick`). */
  kv: { used: number; total: number };
  /** The question being answered right now. */
  topic: string;
  /** What is kept on disk, oldest first, and the model's grouping of it — `null` until it answers. */
  library: KeptArticle[];
  groups: Group[] | null;
}

export const initialState: AppState = {
  phase: "booting",
  boot: null,
  roster: emptyRoster(),
  sources: [],
  queries: [],
  answer: "",
  nothingFound: false,
  accepted: 0,
  error: null,
  kv: { used: 0, total: 0 },
  topic: "",
  library: [],
  groups: null,
};

/** The events `foldAgents` reads. Everything else is this app's own. */
const isAgentEvent = (ev: WorkflowEvent): ev is FoldableEvent & WorkflowEvent =>
  ev.type.startsWith("agent:") && ev.type !== "agent:tick" && ev.type !== "agent:trace";

/** What the roster is told at a spawn. An agent spawned outside a turn works no part of the page, so it is
 *  tracked by its numbers and never shown. The angles carry `taskKey(i)`; the settling agent carries none. */
const spawnDecision = (s: AppState, ev: Extract<FoldableEvent, { type: "agent:spawn" }>) => ({
  timeline: s.phase === "working",
  taskIndex: taskIndexOf(ev.key),
});

export function reduce(s: AppState, ev: WorkflowEvent): AppState {
  if (isAgentEvent(ev)) {
    const roster = foldAgents(s.roster, ev, {
      spawn: (spawn) => spawnDecision(s, spawn),
      terminal: RIG_REPORT.tool,
      terminalField: RIG_REPORT.field,
    });
    // The same events, read a second time for this app's own facts — the payloads the roster summarises away.
    if (ev.type === "agent:tool_result") return { ...s, roster, sources: withArticle(s.sources, ev) };
    if (ev.type === "agent:tool_call") return { ...s, roster, queries: withQuery(s.queries, ev) };
    // A spawn does not mean busy — `query` is what says a turn began.
    return { ...s, roster };
  }

  switch (ev.type) {
    case "ready":
      return { ...s, phase: s.phase === "booting" ? "ready" : s.phase, boot: ev.facts };
    case "query":
      // A fresh roster: the previous turn's agents are not this turn's work, and the page they produced is.
      return {
        ...s,
        phase: "working",
        roster: emptyRoster(),
        // What supports the article is kept exactly as long as the article is.
        sources: ev.warm ? s.sources : [],
        queries: ev.warm ? s.queries : [],
        // The page keeps the subject it was opened on; a follow-up deepens it rather than renaming it.
        topic: ev.warm ? s.topic : ev.text,
        error: null,
        nothingFound: false,
        answer: ev.warm ? s.answer : "",
      };
    case "answer":
      // A null article leaves the page as it was; on a cold turn the preceding `query` already cleared it.
      return {
        ...s,
        phase: "answered",
        answer: ev.text ?? s.answer,
        nothingFound: ev.text === null,
        accepted: ev.text === null ? s.accepted : s.accepted + 1,
        error: null,
      };
    case "run:aborted":
      // The turn ended without an answer. The page decides the phase — an article means `answered`.
      return { ...s, phase: s.answer ? "answered" : "ready" };
    case "library":
      return { ...s, library: ev.articles, groups: ev.groups };
    case "agent:tick":
      return { ...s, kv: { used: ev.cellsUsed, total: ev.nCtx } };

    // ── rig's own words (SettingsEvent) ──
    case "ui:error":
      // A toast, nothing more. A turn ENDING is `run:aborted`, which a dying run says as well as this.
      return { ...s, error: ev.message };

    default:
      return s;
  }
}

// ── this app's domain: the Wikipedia pages behind the article ──────
//
// These read the ability's STRUCTURED tool payloads, never the model's prose. Swap the ability and they stay
// empty; grow the view with one per tool.

/** Parse a tool payload into an object, or null if unparseable/non-object. */
function parseObject(s: string | null): Record<string, unknown> | null {
  if (s === null) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A completed `wikipedia_fetch`, as a card — deduped by url, then title. Errors and other tools pass through. */
function withArticle(seen: WikiSource[], ev: Extract<FoldableEvent, { type: "agent:tool_result" }>): WikiSource[] {
  if (ev.tool !== "wikipedia_fetch") return seen;
  const obj = parseObject(ev.result);
  if (!obj || "error" in obj) return seen;
  const url = str(obj.url);
  const title = str(obj.title);
  const key = url || title;
  if (!key || seen.some((s) => (s.url || s.title) === key)) return seen;
  return [
    ...seen,
    {
      title: title ?? "Untitled",
      snippet: str(obj.extract) ?? str(obj.description) ?? "",
      url: url ?? "",
      thumbnail: str(obj.thumbnail),
    },
  ];
}

/** A `wikipedia_search`'s query, once. */
function withQuery(seen: string[], ev: Extract<FoldableEvent, { type: "agent:tool_call" }>): string[] {
  if (ev.tool !== "wikipedia_search") return seen;
  const q = str(parseObject(ev.args)?.query)?.trim();
  return q && !seen.includes(q) ? [...seen, q] : seen;
}

// ── derivations over the roster ────────────────────────────────────

/** The agents that READ — one per angle of the question. The settling agent works no angle: its prose is the
 *  article, so it is shown as the page rather than as a worker. */
export const isWikiAgent = (a: AgentRuntime): boolean => a.taskIndex !== null;

/** Still working. An agent spends most of its run waiting on a tool, so anything but a terminal phase counts. */
export const isLiveAgent = (a: AgentRuntime): boolean => a.phase !== "done" && a.phase !== "failed";

/** Every think block this agent has written, oldest first — its reasoning, with the markup already gone. */
export const reasoningOf = (a: AgentRuntime): string =>
  (a.timeline ?? [])
    .flatMap((it) => (it.kind === "think" ? [it.body] : []))
    .join("\n\n")
    .trim();

/** The findings it filed, or null while it is still writing them. */
export const reportOf = (a: AgentRuntime): string | null => {
  const filed = (a.timeline ?? []).flatMap((it) => (it.kind === "report" ? [it.body] : []));
  return filed.length > 0 ? filed[filed.length - 1] : null;
};

/** The model is organising the shelf right now. Derived, not announced: the classifier is an agent like any
 *  other, and an agent alive while no turn is running is that one. `groups === null` cannot say this — it is
 *  equally "not started" and "refused". */
export const isGrouping = (s: AppState): boolean =>
  s.phase !== "working" && [...s.roster.agents.values()].some(isLiveAgent);

export interface Shelf {
  /** Null is the ungrouped run — before the model answers, and for anything its grouping left out. */
  topic: string | null;
  articles: KeptArticle[];
}

/** The landing's shelf: ONE shape whether or not the model has grouped anything, so the first moment, the
 *  single-article case and a refused grouping are the same render — no loading, empty or error state. */
export function shelf(s: AppState): Shelf[] {
  if (s.library.length === 0) return [];
  if (!s.groups) return [{ topic: null, articles: s.library }];
  const byId = new Map(s.library.map((a) => [a.id, a]));
  const grouped = s.groups
    .map((g) => ({ topic: g.topic, articles: g.ids.flatMap((id) => byId.get(id) ?? []) }))
    .filter((g) => g.articles.length > 0);
  // A grouping that left articles out shows them anyway: the model's answer decides the shape, never what is kept.
  const placed = new Set(grouped.flatMap((g) => g.articles.map((a) => a.id)));
  const rest = s.library.filter((a) => !placed.has(a.id));
  return rest.length ? [...grouped, { topic: null, articles: rest }] : grouped;
}
