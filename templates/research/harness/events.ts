/**
 * WorkflowEvent — everything the harness says on the wire.
 *
 * `StepEvent` is this harness's own vocabulary (pipeline phases, plan edits,
 * boot, config, the library); `AgentEvent` streams from
 * @lloyal-labs/lloyal-agents; `HostResourcesEvent` is the dev pane's machine
 * telemetry. Every target folds the same union through ONE `reduce`.
 */

import type { AgentEvent } from '@lloyal-labs/lloyal-agents';
import type { Descriptor } from '@lloyal-labs/media';
import type { HostResourcesEvent } from '@lloyal-labs/dev-tools';
import type { PlanIntent, ResearchTask } from '@lloyal-labs/rig';
import type { AbilityDescriptor, DocId, LibraryEntry, Mode, OpTiming } from './state-core.js';
import type { Effort } from './effort-presets.js';
import type { Config, ConfigOrigin } from './config-types.js';

/** The terminal event's stats payload. Everything optional: the research
 *  path fills the research fields, passthrough its own, and a library
 *  restore sends `{}` — the fold keys off the EVENT, not this payload. */
export interface CompleteData {
  intent?: string;
  planTokens?: number;
  agentTokens?: number;
  synthTokens?: number;
  passthroughTokens?: number;
  totalToolCalls?: number;
  agentCount?: number;
  wallTimeMs?: number;
  planMs?: number;
  researchMs?: number;
  synthMs?: number;
  passthroughMs?: number;
}

export type StepEvent =
  | {
      type: 'query';
      /** THE echo — mints the document's identity. Every surface keys on it:
       *  the fold's DocState, the /brief/:docId route, the run-dir folder. */
      docId: DocId;
      query: string;
      /** An ask INTO the (settled) document this event names. */
      warm: boolean;
      /** Skip-planner run: the question IS the plan, so one agent answers
       *  with every ability's tools registered. A COLD ask is direct and
       *  not warm; a WARM query is always direct (asks are the only
       *  follow-up). */
      direct?: boolean;
      /** The effort this run was submitted at. The config default can be
       *  retoggled mid-run; time math must key off the run's own effort. */
      effort?: Effort;
      /** Root manifest descriptors for images attached to THIS turn — never
       *  bytes. Bytes on the wire would land in the web bridge's 50k-frame
       *  replay history, which is sized on the assumption that frames are
       *  tiny. The view resolves each descriptor to the ADMITTED
       *  representation over the content plane's GET, which is also what the
       *  model actually saw — the local object URL is only an optimistic
       *  pre-submit preview and cannot be joined by digest (the browser holds
       *  the SOURCE hash; this is the MANIFEST hash). */
      attachments?: Descriptor[];
    }
  | {
      type: 'plan';
      intent: PlanIntent;
      tasks: ResearchTask[];
      clarifyQuestions: string[];
      tokenCount: number;
      timeMs: number;
    }
  | { type: 'research:start'; agentCount: number; mode: 'flat' | 'deep' }
  | { type: 'research:done'; totalTokens: number; totalToolCalls: number; timeMs: number }
  | { type: 'fanout:tasks'; tasks: ResearchTask[] }
  /** Tasks the plan named that cannot hold a branch yet. `nSeqMax` is a
   *  hard reservation, so a plan wider than the budget runs in waves; these
   *  are the ones still queued. Empty once every task has forked. */
  | { type: 'fanout:waiting'; taskIndices: number[] }
  | { type: 'spine:task'; taskIndex: number; taskCount: number; description: string }
  | { type: 'spine:source'; taskIndex: number; source: string }
  | { type: 'spine:task:done'; taskIndex: number; stageFindings: number; accumulated: number }
  | { type: 'synthesize:start' }
  | {
      type: 'synthesize:done';
      agentId: number;
      ppl: number;
      tokenCount: number;
      toolCallCount: number;
      timeMs: number;
    }
  | { type: 'answer'; text: string }
  /** A settled document, whole, from disk — upserts a DocState at phase
   *  'done'. Does NOT activate (doc:active is its own event). Exchange
   *  digests are store-validated by the sender. */
  | {
      type: 'doc';
      docId: DocId;
      title: string;
      mode: Mode | null;
      attachments?: Descriptor[];
      answer: string;
      exchanges: { question: string; body: string; attachments: string[] }[];
    }
  /** Activation is its own fact: what the canvas shows. Null = the picker. */
  | { type: 'doc:active'; docId: DocId | null }
  /** The run stopped short of complete (stop / cancel). A stillborn doc
   *  dies with it; a settled doc stands with its ask cleared. No toast. */
  | { type: 'run:aborted' }
  | {
      type: 'stats';
      timings: OpTiming[];
      kvLine?: string;
      ctxPct: number;
      ctxPos: number;
      ctxTotal: number;
    }
  | { type: 'complete'; data: CompleteData }
  // ── UI / config events driven by main.ts ────────────────────────
  // `path` is the file the config was loaded from — absent for the in-memory
  // runner (nothing is read from disk today).
  | {
      type: 'config:loaded';
      config: Config;
      origin: ConfigOrigin;
      path?: string;
      /** The boot's LLOYAL_DEV signal on the wire — the dev pane's gate.
       *  Absent/false ⇒ no dev surface renders, ever. */
      dev?: boolean;
    }
  | {
      type: 'config:updated';
      config: Config;
      origin: ConfigOrigin;
      /** The file the save landed in — null when nothing was persisted (a
       *  served session's in-memory patch). */
      savedTo: string | null;
      gitignored: boolean;
      skipped: string[];
    }
  // ── Pre-flight recon (RFC: multi-ability composition) — a recon agent probes
  // ── each source for the query's entities BEFORE planning to ground routing.
  // ── Its probe calls also stream as agent:* events (rendered live), so these
  // ── two only bracket the phase; the per-probe detail is the agent stream.
  | { type: 'preflight:start'; query: string; abilityCount: number }
  | {
      type: 'preflight:done';
      coverage: string;
      tokens: number;
      toolCalls: number;
      timeMs: number;
    }
  | { type: 'plan:start'; query: string; mode: 'flat' | 'deep' }
  // ── Plan-edit events: user-driven mutations of state.plan.tasks before
  // ── accept_plan. afterIndex: -1 means prepend; out-of-bounds indices
  // ── on the others are reducer no-ops (defensive).
  | { type: 'plan:task_updated'; index: number; description: string }
  | { type: 'plan:task_added'; afterIndex: number }
  | { type: 'plan:task_deleted'; index: number }
  | { type: 'plan:task_moved'; from: number; to: number }
  | { type: 'ui:plan_review' }
  /** A toast — one meaning only. Never folds as an abort: a dying run
   *  emits `run:aborted` alongside; a benign failure toasts alone. */
  | { type: 'ui:error'; message: string }
  // ── Boot-phase events: the weight-loading spinner ──
  | { type: 'weights:label'; label: string }
  | { type: 'weights:done' }
  | { type: 'corpus:indexed'; corpusPath: string; fileCount: number; chunkCount: number }
  // ── The library: settled briefs on disk (the sidebar's Completed
  // ── reports). Opening one upserts it whole via the `doc` event.
  | { type: 'library:list'; entries: LibraryEntry[] }
  /** Report paths ranked against `query`, best first. An empty query means
   *  the search is cleared. Scores stay host-side: they are logit-diffs whose
   *  gaps are not meaningful to render — only the ORDER travels. */
  | { type: 'library:search'; query: string; ranked: string[] }
  // Per-query Ability participation toggle. Emitted by main.ts in response to
  // a `toggle_participation` Command from the Composer. The reducer flips
  // the bit in `state.participation[name]`. Pure UI state — no harness
  // side effects; main.ts derives `abilityFilter` from `state.participation`
  // at submit time and threads it into runQuery / runResearchPlan.
  | { type: 'participation:toggled'; name: string }
  // Installed-Abilities snapshot for the Settings drawer. Emitted by main.ts
  // after boot completes AND after every registry enable/disable/config
  // change. The reducer drops it whole into `state.abilities`. Display-only — the
  // catalog-metadata join (title/iconUrl/entitlements) is best-effort and
  // falls back to manifest-only fields on any catalog fetch failure.
  | { type: 'abilities:state'; abilities: AbilityDescriptor[] };

export type WorkflowEvent = AgentEvent | StepEvent | HostResourcesEvent;
