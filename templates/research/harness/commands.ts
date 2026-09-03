/**
 * UI → main.ts command boundary.
 *
 * The Ink component tree dispatches commands through the `useCommand`
 * hook; main.ts drains them from an Effection Signal and runs the
 * corresponding Operation (runPlanner, runResearch, saveConfig, ...).
 *
 * Keep the union small and explicit. No generic "send arbitrary event"
 * escape hatch — that's what makes the UI <-> harness boundary auditable.
 */

import type { Descriptor } from '@lloyal-labs/media';

export type Command =
  | {
      type: 'submit_query';
      query: string;
      mode: 'flat' | 'deep';
      skipPlanner?: boolean;
      /** ROOT descriptors for images ALREADY admitted over the content plane —
       *  never bytes.
       *
       *  This field used to be `images: string[]`, base64, because the wss
       *  transport is JSON-only and a `Uint8Array` does not survive it
       *  (`JSON.stringify` yields `{"0":…}`; a binary frame gets coerced with
       *  `String(data)` — both corrupt silently). The answer was not a better
       *  encoding: it was to stop putting bytes on this wire at all. The
       *  bridge keeps every frame for replay, so an image here would sit in
       *  the history forever, and the history is sized for tiny frames.
       *
       *  Untrusted — a descriptor here is a CLAIM about content, not proof of
       *  it. The handler narrows with `asAttachment` and resolves through the
       *  store; a forged one fails there rather than misleading. */
      attachments?: Descriptor[];
    }
  | { type: 'submit_clarification'; answer: string }
  | { type: 'accept_plan' }
  | { type: 'cancel_plan' }
  | { type: 'edit_plan'; query: string }
  | { type: 'change_mode'; mode: 'flat' | 'deep' }
  | { type: 'update_task_description'; index: number; description: string }
  | { type: 'add_task'; afterIndex: number }
  | { type: 'delete_task'; index: number }
  | { type: 'move_task'; from: number; to: number }
  | { type: 'set_ability_config'; name: string; values: Record<string, unknown> }
  | { type: 'set_output_dir'; path: string }
  // The library — settled briefs on disk (the sidebar's Completed reports).
  // Replies ride the event bus one-way, like `corpus:indexed`. All paths
  // are confined to report.md files under the output dir. On a SERVED host
  // the library is deliberately shared: every session on the appliance
  // reads, restores, and curates the same reports/ — a team's collective
  // research memory, not a per-tenant store.
  // `open_doc` upserts the report whole into the fold (`doc` + `doc:active`)
  // and binds it for the lazy trunk commit on the first submit over it.
  // `library_delete` removes the brief's WHOLE run dir (report + annexures)
  // and re-indexes the corpus — the system unlearns it; replies with the
  // refreshed `library:list`.
  /** Halt anything live, clear the canvas, return to the shape picker. KV
   *  stays lazy — the next submit's boundary releases the old doc's branch. */
  | { type: 'new_run' }
  | { type: 'library_list' }
  /** Rank the library against a query with the session reranker. Empty query
   *  clears the search. Ignored while a run is active — the reranker is the
   *  run's scoring instrument, and search must not queue behind it. */
  | { type: 'library_search'; query: string }
  /** Navigate the canvas to a document — view-only, legal during runs.
   *  Null returns to the picker without halting anything (that's new_run's
   *  job). The id is the run-dir basename, minted at the query echo. */
  | { type: 'open_doc'; docId: string | null }
  | { type: 'library_delete'; path: string }
  // Global run-effort setting (pure policy preset). Set in Settings → Effort;
  // persisted to harness.json and applied to every subsequent query.
  | { type: 'set_effort'; effort: 'low' | 'medium' | 'high' | 'ultra' }
  | { type: 'set_model_path'; path: string }
  | { type: 'set_reranker_path'; path: string }
  // GPU backend variant (persisted as model.gpu; main.ts restarts the boot so
  // ctx + reranker reload on the new backend). Values mirror lloyal.node's
  // GpuVariant; 'default' = the platform binary's built-in backend.
  | { type: 'set_gpu'; gpu: 'default' | 'cuda' | 'vulkan' }
  // Per-image token budget for a vision model. Carried as the STRING the
  // slider offers ('auto' | '256' | …) rather than a number, so the UI's
  // option list is the only place the steps are written down. 'auto' persists
  // 0, which is the binding's own "unset" sentinel (it applies the value only
  // when > 0), so auto and never-configured are the same state.
  | { type: 'set_image_min_tokens'; value: string }
  | { type: 'set_image_max_tokens'; value: string }
  | { type: 'toggle_participation'; name: string }
  // Escape hatch: interrupt the in-flight run (planner / research / synth) and
  // return to the composer. Handled in main.ts's command loop by halting the
  // spawned run Task (Effection halt tears down the run scope + cancels any
  // parked tool fetch via cancellable-fetch's scope-signal) and sending
  // `run:aborted`. No-op when no run is active. Never kills the loop/process.
  | { type: 'stop' }
  // Graceful "Wrap up": drain the in-flight run to a fast best-effort answer
  // instead of aborting it. Handled in main.ts by sending the WindDown signal
  // (NOT halting) — the pool stops spawning, reaps active agents, lets in-flight
  // tools settle, and folds the cohort into a recovered answer + synth. No-op
  // when no run is active. Distinct from `stop` (abort → composer).
  | { type: 'wrap_up' }
  // Hold the run at the tick boundary / release it. Refused when not
  // plainly running (the pane's buttons mirror these rules as affordance).
  | { type: 'pause' }
  | { type: 'resume' }
  // Per-agent cancel: discard one LIVE flat-mode research agent (halt its tool +
  // prune its KV + terminal agent:failed(user_cancel)); siblings keep running. The
  // renderer only offers this on a live, non-recovering flat-mode card.
  | { type: 'cancel_agent'; agentId: number }
  | { type: 'quit' };
