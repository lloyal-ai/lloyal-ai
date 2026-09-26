/**
 * AppState — the ONE fold every target shares.
 *
 * Populated by reduce.ts from the WorkflowEvent stream; node-free, so the
 * cli's Ink view, the desktop main process (the authoritative fold behind
 * `harness:snapshot`), and the browser page all fold the same state.
 * Renderers derive from this state and nothing else — the React view
 * through `select.ts` (the domain seam), the Ink view directly.
 *
 * Each research agent owns a vertical `timeline` of items (think blocks,
 * tool calls, tool results, reports); how a renderer lays those out —
 * columns, sections, panes — is the renderer's business, not this file's.
 */

import type { Config } from '../config.js';
import type { Descriptor } from '@lloyal-labs/media';
import type { Effort } from '../harness/budgets.js';
import type { Reports } from '@lloyal-labs/rig';
import type { DocId, Mode, LibraryEntry } from '../protocol.js';

export type { DocId, Mode, LibraryEntry } from '../protocol.js';
export { reduce } from './reduce.js';

/** The view's transport link to the host — a fact of the wire, not the fold; binding's word. */
export type { WireStatus } from '@lloyal-labs/binding';

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

/** The agent records are the generic fold's (`@lloyal-labs/ui/fold`): one agent's life on a view, folded from
 *  the bus events every pool emits; this app decides only what a spawn is for. */
export type { AgentRoster, AgentRuntime, TimelineItem, SourceMeta } from '@lloyal-labs/ui/fold';
export { extractStreamingReport } from '@lloyal-labs/ui/fold';
import type { AgentRoster, AgentRuntime } from '@lloyal-labs/ui/fold';

export interface Pressure {
  pct: number;
  cellsUsed: number;
  nCtx: number;
}

/** The settling pass. Its agent is in the roster like any other, with a timeline: what it deliberated and what
 *  it wrote are read from there, never held here. */
export interface SynthState {
  open: boolean;
  /** The settling agent, once it has spawned; null before, and for a run that never settled. */
  agentId: number | null;
  done: boolean;
  stats: { tokens: number; toolCalls: number; ppl: number; timeMs: number } | null;
}

export interface Toast {
  message: string;
  tone: 'info' | 'success' | 'warn' | 'error';
  /** Monotonic id so the view can animate/dismiss on change. */
  id: number;
}

/** The ability descriptor is rig substrate — one builder, one shape. */
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
  /** The planning round the harness armed (`ui:plan_review` / `ui:clarify`); the interface sends it back
   *  with a yes, an answer or an edit, and a stale one is refused. Null when nothing is parked. */
  revision: number | null;
  /** Every agent this document ever ran, done agents included, as the generic fold keeps them:
   *  its value, folded in place, never spelled out here. Bounded by task count. */
  roster: AgentRoster;
  /** Pre-flight recon agents in spawn order — drives the Discovering view. */
  reconAgentIds: number[];
  /** Authoritative fork count from `research:start`. */
  researchAgentCount: number;
  /** How this run's inquiries hand in their findings, as `research:start` said; null when it did not say. */
  reports: Reports | null;

  synth: SynthState;
  answer: string | null;
  /** Warm-ask exchanges appended beneath the settled brief. A null body is an ask that found nothing: the reader
   *  asked, nothing was kept, and the view says so where the answer would be. */
  exchanges: { question: string; body: string | null; attachments: string[] }[];
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
