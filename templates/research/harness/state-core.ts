/**
 * AppState — the ONE fold every target shares.
 *
 * Populated by reducer.ts from the WorkflowEvent stream; node-free, so the
 * cli's Ink view, the desktop main process (the authoritative fold behind
 * `harness:snapshot`), and the browser page all fold the same state.
 * Renderers derive from this state and nothing else — the React view
 * through `select.ts` (the domain seam), the Ink view directly.
 *
 * Each research agent owns a vertical `timeline` of items (think blocks,
 * tool calls, tool results, reports); how a renderer lays those out —
 * columns, sections, panes — is the renderer's business, not this file's.
 */

import type { Config, ConfigOrigin } from './config-types.js';
import type { Descriptor } from '@lloyal-labs/media';
import type { Effort } from './effort-presets.js';

/** The view's transport link to the host — a fact of the wire, NOT the
 *  harness fold (the harness never knows if a browser's socket dropped).
 *  'connecting' at load, 'connected' once the host is ready, 'lost' when the
 *  socket dies under a live view. The web bridge reports it; the in-process
 *  cli/desktop bridges never leave 'connected'. */
export type WireStatus = 'connecting' | 'connected' | 'lost';

/** One document's identity — the SAME string names the fold's DocState, the
 *  browser route (/brief/:docId), and the run-dir folder on disk. ISO-
 *  timestamp shaped (2026-09-02T10-30-00-000): sortable, URL-safe, minted
 *  once by the harness at the query echo. */
export type DocId = string;

export type SessionPhase = 'boot' | 'ready';

/** A document's lifecycle. The picker is NOT a phase — it is the absence of
 *  an active document (activeDocId === null). */
export type DocPhase =
  | 'planning'      // planner running (also a warm ask's synthetic instant)
  | 'discovering'   // pre-flight recon agents probing sources
  | 'clarifying'    // planner asked questions; composer takes the answer
  | 'plan_review'   // plan dialog visible, accept/edit/change-mode
  | 'research'      // inquiries streaming
  | 'synthesizing'  // the settling pass
  | 'done';         // settled; asks stream beneath without leaving 'done'

/** Every DocPhase, for totality walks — a table keyed by DocPhase plus this
 *  list is the pattern that keeps moment/status maps honest by test. */
export const DOC_PHASES: readonly DocPhase[] = [
  'planning', 'discovering', 'clarifying', 'plan_review',
  'research', 'synthesizing', 'done',
];

/** User-facing reasoning mode. 'deep' == chain-shaped orchestration
 *  (sequential tasks that build on each other); 'flat' == parallel-shaped
 *  orchestration (orthogonal tasks running concurrently). One encoding
 *  everywhere — no 'chain' alias. */
export type Mode = 'flat' | 'deep';

/** One settled brief on disk — a sidebar library row (`library:list`). */
export interface LibraryEntry {
  path: string;
  /** The identity — the run-dir's basename; keys the route and the fold. */
  docId: DocId;
  title: string;
  savedAt: string;
  mode: Mode | null;
  /** The brief carried images — its meta line names their roots. */
  hasMedia: boolean;
}

/** One cited source, extracted CONSUMER-side from a tool result (the Ability
 *  Protocol prescribes no result schema). Web tools populate url/title/snippet
 *  today; image (og:image) + icon (favicon) arrive once the web ability ≥1.2.0
 *  emits them. Ability-agnostic — corpus/other abilities fill whatever subset applies. */
export interface SourceMeta {
  url?: string;
  title?: string;
  snippet?: string;
  /** og:image URL (or a local cache ref once the engine inlines it). */
  image?: string;
  /** favicon URL. */
  icon?: string;
  /** Display host, derived from url when present. */
  host?: string;
}

/** Per-agent chronological stream item. Column.tsx renders one component
 *  per kind. `live: true` on a think item means its body is currently
 *  streaming tokens and should render with a `▎` cursor. */
export type TimelineItem =
  | {
      kind: 'think';
      id: number;
      title: string;
      body: string;
      live: boolean;
      openedAt: number;
      closedAt: number | null;
    }
  | {
      kind: 'tool_call';
      id: number;
      tool: string;
      argsSummary: string;
    }
  | {
      kind: 'tool_result';
      id: number;
      tool: string;
      /** Optional back-reference to the tool_call id this result pairs with.
       *  Column renderer indents results under their matching call. */
      callId: number | null;
      byteLength: number;
      preview: string | null;
      hosts: string[];
      resultCount: number | null;
      /** Per-source citation metadata extracted from the tool's (free-form)
       *  result — the Ability Protocol prescribes no result schema, so this is a
       *  CONSUMER-side convention parsed in summarizeResult from known tool
       *  shapes (web_search/fetch_page already return url+title+snippet;
       *  fetch_page additionally emits og:image + favicon once web ≥1.2.0).
       *  Drives the per-page rows in the Sources ledger. Empty/undefined for
       *  tools that surface no per-source data (grep, corpus search). */
      sources?: SourceMeta[];
    }
  | {
      kind: 'report';
      id: number;
      body: string;
      tokenCount: number;
    };

export interface AgentRuntime {
  id: number;
  label: string;                          // "A0", "A1", …
  phase: 'idle' | 'thinking' | 'content' | 'tool' | 'done' | 'failed';
  tokenCount: number;
  toolCallCount: number;
  /** Wall-clock spawn time (ms) — start of this task's elapsed timer. */
  startedAt: number;
  /** Wall-clock completion time (ms), set when the agent reaches `done`
   *  (agent:return / agent:recovered). Null while running. Elapsed =
   *  (endedAt ?? now) − startedAt. */
  endedAt: number | null;
  /** Research task index this agent was spawned for. Null for synth. */
  taskIndex: number | null;
  /** Short task description, used in the column header when present. */
  taskDescription: string | null;
  /** Chain-mode dependency hint ("builds on Task 1"), shown in header. */
  dependencyHint: string | null;
  /** Id of the currently-live think item in `timeline`, or null. */
  currentThinkId: number | null;
  /** Id of the most recent tool_call, paired with its tool_result when one lands. */
  pendingToolCallId: number | null;
  /** Live park-and-retry state for the pending tool call (rate-limited
   *  provider; pool re-executes after the delay). Set on agent:tool_retry,
   *  cleared when the eventual tool_result lands. Renders as
   *  "rate-limited — retrying in ~Ns" so a waiting agent never reads as
   *  hung. */
  retry: { tool: string; retryAt: number; attempt: number } | null;
  /** Live post-</think> token buffer. Tokens stream into this between
   *  closing a think block and the next agent:tool_call / agent:report
   *  (the model is writing tool-call JSON — the terminal `report` tool's body
   *  lives inside that JSON, between `<parameter=result>` and `</parameter>`,
   *  raw and unescaped). Renderers extract the live report body straight from
   *  this buffer via `extractStreamingReport` below (consumed by Column.tsx's
   *  ContentStream and the desktop renderer's Work.tsx) — same
   *  marker-delimited technique the think block uses with `</think>`. Cleared
   *  on tool_call / report (those fire structured items instead). */
  contentBuffer: string;
  /** True while the agent is being force-recovered: `agent:done` fired (the
   *  agent stalled without a voluntary report) and `recoverInline` is streaming
   *  a forced report under an EAGER report grammar (no `<think>`/`</think>`).
   *  Routes those `agent:produce` tokens into `contentBuffer` (→ "Writing
   *  report") instead of a think block, so a recovered report isn't mislabeled
   *  as the agent "Thinking". Set on `agent:done`, cleared on
   *  `agent:return`/`agent:recovered`. See docs/upstream-issues.md. */
  recovering: boolean;
  /** Set when the agent's forced recovery FAILED (e.g. KV exhausted mid-report
   *  decode → `llama_decode failed`): no result was produced. Drives the terminal
   *  failure glyph (a cross) + frozen timer instead of an eternal "Writing report"
   *  spinner. Set on `agent:failed`; null otherwise. */
  failReason: string | null;
  /** Per-agent chronological stream. */
  timeline: TimelineItem[];
}

/** Live report markdown from a raw Hermes terminal-tool buffer:
 *  `…<parameter=result>\n<markdown>\n</parameter>…`. Raw <parameter> values are
 *  unescaped, so no decoding — same idea as streaming a think block until </think>.
 *  Returns the body (to the close marker, or buffer tail if not arrived), or null.
 *  Null until the open marker arrives — that gating is what keeps non-terminal
 *  tool-call args (search queries, URLs) from flashing as report prose. Callers
 *  branch on `recovering` first: a forced recovery streams raw prose with no
 *  envelope, so the buffer is used verbatim there. */
export function extractStreamingReport(buffer: string): string | null {
  const OPEN = '<parameter=result>';
  const i = buffer.indexOf(OPEN);
  if (i === -1) return null;
  let body = buffer.slice(i + OPEN.length);
  const c = body.indexOf('</parameter>');
  if (c !== -1) body = body.slice(0, c);
  return body.replace(/^\n/, '');
}

export interface Pressure {
  pct: number;
  cellsUsed: number;
  nCtx: number;
}

export interface SynthState {
  open: boolean;
  buffer: string;
  done: boolean;
  stats: { tokens: number; toolCalls: number; ppl: number; timeMs: number } | null;
}

export interface OpTiming {
  label: string;
  tokens: number;
  detail: string;
  timeMs: number;
}

export interface Toast {
  message: string;
  tone: 'info' | 'success' | 'warn' | 'error';
  /** Monotonic id so the view can animate/dismiss on change. */
  id: number;
}

/** A signed entitlement disclosed by an ability's catalog metadata. The `key`
 *  maps to a privacy-label-style pill (network → Internet, etc.); `label`
 *  is the human-readable name carried alongside it. */
export interface AppEntitlement {
  key: string;
  label: string;
}

/** The ability descriptor is rig substrate now — one builder, one shape. */
import type { AbilityDescriptor } from "@lloyal-labs/rig";
export type { AbilityDescriptor };

/** Session-scoped facts: the machine, the configuration, the library. They
 *  survive every document birth and switch — there is NO code path that
 *  resets them. */
export interface SessionState {
  phase: SessionPhase;
  /** The wire's dev signal (`config:loaded.dev` — the boot's LLOYAL_DEV). */
  dev: boolean;
  /** Merged config from CLI > env > file > default. Null until config:loaded. */
  config: Config | null;
  /** "Loading weights…" / "Loading reranker…" while the session boots. */
  loadingLabel: string | null;
  /** Corpus indexing summary — the Composer's Corpus chip. */
  corpusStatus: { fileCount: number; chunkCount: number } | null;
  /** KV pressure of the ONE shared llama context — machine truth; it
   *  survives document switches because the cache does. */
  pressure: Pressure | null;
  /** Most recent transient toast (e.g. "saved → harness.json"). */
  toast: Toast | null;
  nextToastId: number;
  /** Settled briefs on disk (`library:list`). */
  library: { entries: LibraryEntry[] };
  /** Live semantic search over the library; null when not searching. */
  librarySearch: { query: string; ranked: string[] } | null;
  /** Per-ability participation in the next query, keyed by manifest.name. */
  participation: Record<string, boolean>;
  /** Installed Abilities surfaced into the renderer. */
  abilities: AbilityDescriptor[];
}

/** One document, whole: its identity, its content, and its run machinery.
 *  Born by the query echo, grown by run events routed via `runDocId`,
 *  upserted whole from disk by the `doc` event. Never reused, never reset —
 *  a new document is a new entry. */
export interface DocState {
  id: DocId;
  /** The document's title — the question that started it. */
  query: string;
  /** Root manifest descriptors for images attached to the query. */
  attachments: Descriptor[];
  mode: Mode | null;
  /** Born as a direct ask (skipPlanner) — drives the run's shape chip. */
  direct: boolean;
  /** The run's own effort, as submitted — distinct from the config default. */
  runEffort: Effort | null;
  phase: DocPhase;
  plan: {
    intent: string;
    tasks: { description: string; ability?: string }[];
    clarifyQuestions: string[];
    tokenCount: number;
    timeMs: number;
  } | null;
  /** Every agent this document ever ran, done agents included — the map is
   *  the record; there is no separate archive. Bounded by task count. */
  agents: Map<number, AgentRuntime>;
  /** Research agents in spawn order — drives the column layout. */
  researchAgentIds: number[];
  /** Pre-flight recon agents in spawn order — drives the Discovering view. */
  reconAgentIds: number[];
  /** Plan tasks still queued for a branch (fork waves under nSeqMax). */
  waitingTaskIndices: number[];
  /** Set by spine:task in chain mode; consumed by the next agent:spawn. */
  pendingTaskIndex: number | null;
  pendingTaskDescription: string | null;
  /** Count of research-phase spawns seen (assigns taskIndex in flat mode). */
  researchSpawnCount: number;
  /** Authoritative fork count from `research:start`. */
  researchAgentCount: number;
  /** Monotonic counters for stable timeline/label ids within this doc. */
  nextTimelineId: number;
  nextLabelIdx: number;
  synth: SynthState;
  answer: string | null;
  /** Warm-ask exchanges appended beneath the settled brief. */
  exchanges: { question: string; body: string; attachments: string[] }[];
  /** The warm ask in flight (its question); null otherwise. */
  ask: string | null;
  /** The in-flight ask's media digests, landed on the settled exchange. */
  askAttachments: string[];
  paused: boolean;
  closing: boolean;
  closedEarly: boolean;
  /** Pipeline-active milliseconds (excludes review dwell and idle). */
  pipelineElapsedMs: number;
  pipelineResumedAt: number | null;
}

/** The ONE fold every target shares: session facts, the documents this
 *  session has touched, and two pointers — what the canvas shows and what
 *  the run writes into. Cross-document staleness is unrepresentable: no
 *  run-scoped slot is ever reused across documents. */
export interface AppState {
  session: SessionState;
  documents: Map<DocId, DocState>;
  /** What the canvas shows; null = the picker. */
  activeDocId: DocId | null;
  /** What the live run writes into; null = no run. */
  runDocId: DocId | null;
}

export const initialSession: SessionState = {
  phase: 'boot',
  dev: false,
  config: null,
  loadingLabel: null,
  corpusStatus: null,
  pressure: null,
  toast: null,
  nextToastId: 0,
  library: { entries: [] },
  librarySearch: null,
  participation: {},
  abilities: [],
};

export const initialState: AppState = {
  session: initialSession,
  documents: new Map(),
  activeDocId: null,
  runDocId: null,
};
