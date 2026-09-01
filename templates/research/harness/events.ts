/**
 * WorkflowEvent — everything the harness says on the wire.
 *
 * `StepEvent` is this harness's own vocabulary (pipeline phases, plan edits,
 * boot, config, the library); `AgentEvent` streams from
 * @lloyal-labs/lloyal-agents; `HostResourcesEvent` is the dev pane's machine
 * telemetry. Every target folds the same union through ONE `reduce`.
 */

import type { AgentEvent } from '@lloyal-labs/lloyal-agents';
import type { HostResourcesEvent } from '@lloyal-labs/dev-tools';
import type { PlanIntent, ResearchTask } from '@lloyal-labs/rig';
import type { AbilityDescriptor, LibraryEntry, OpTiming } from './state-core.js';
import type { Config, ConfigOrigin } from './config-types.js';
import type { Descriptor } from '@lloyal-labs/media';

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
      query: string;
      warm: boolean;
      /** Skip-planner run: the question IS the plan, so one agent answers with
       *  every ability's tools registered. Distinct from `warm`, which says a
       *  trunk existed — a COLD ask is direct and not warm. */
      direct?: boolean;
      /** Root manifest descriptors for images attached to THIS turn — never
       *  bytes. The view resolves each to the ADMITTED representation over the
       *  content plane, which is what the model saw; a local object URL is an
       *  optimistic pre-submit preview and cannot be joined by digest. */
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
  /** Tasks the plan named that cannot hold a branch yet. `nSeqMax` is a hard
   *  reservation, so a plan wider than the budget forks in waves; these are the
   *  ones still queued. Empty once every task has forked. */
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
  | { type: 'ui:composer'; prefill?: string }
  /** The document is cleared and the picker is back. Distinct from
   *  `ui:composer`, which moves the phase but keeps the settled answer. */
  | { type: 'ui:new_run' }
  | { type: 'ui:plan_review' }
  | { type: 'ui:error'; message: string }
  // ── Boot-phase events: download progress + weight-loading spinner ──
  /** Pre-populates `state.downloads` with the full set of files about to
   *  be fetched. Sent ONCE before any individual download:start so the
   *  dynamic tree size is fixed from the moment 'downloading' begins. */
  | { type: 'download:plan'; entries: { id: string; label: string; sizeBytes: number }[] }
  | { type: 'download:start'; id: string; label: string; sizeBytes: number }
  | { type: 'download:progress'; id: string; got: number; total: number; url?: string }
  | { type: 'download:complete'; id: string }
  | { type: 'weights:start'; label: string }
  | { type: 'weights:label'; label: string }
  | { type: 'weights:done' }
  | { type: 'corpus:indexed'; corpusPath: string; fileCount: number; chunkCount: number }
  // ── The library: settled briefs on disk (the sidebar's Completed
  // ── reports). Opening one restores it through the STANDARD
  // ── query/answer/complete events — no dedicated body event exists.
  | { type: 'library:list'; entries: LibraryEntry[] }
  /** Report paths ranked against `query`, best first. An empty query means
   *  the search is cleared. Scores stay host-side: they are logit-diffs whose
   *  gaps are not meaningful to render — only the ORDER travels. */
  | { type: 'library:search'; query: string; ranked: string[] }
  | { type: 'boot:error'; kind: 'llm' | 'reranker' | 'backend-pack'; message: string }
  /** Boot-time BACKEND_DL pack offer: a CUDA GPU was probed and a signed
   *  full-arch pack is available for it. Rendered as a Download / Not now
   *  dialog (uiPhase 'backend_pack_offer'); answered via the
   *  accept_backend_pack / decline_backend_pack commands. */
  | {
      type: 'backendpack:offer';
      gpuName: string;
      sizeBytes: number;
      needsRuntime: boolean;
      runtimeSizeBytes: number;
      reasons: string[];
    }
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
