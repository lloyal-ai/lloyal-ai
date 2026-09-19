/**
 * Everything this app says and hears. `Command` is everything a reader can do, and it is the table of contents
 * of the app: each one has a handler in the brief, the library or rig's settings. `WorkflowEvent` is everything
 * a view is told; a view shows nothing it was not told here.
 *
 * rig owns two vocabularies that sit beside the brief's own: the controls of a live run (`RunCommand`) and
 * settings (`SettingsCommand`, `SettingsEvent`). Node-free, so a view imports this without importing the engine.
 */
import type { AgentEvent } from "@lloyal-labs/lloyal-agents";
import type { HostResourcesEvent } from "@lloyal-labs/rig";
import type { Descriptor } from "@lloyal-labs/media";
import type { PlanIntent, Reports, ResearchTask, RunCommand, SettingsCommand, SettingsEvent } from "@lloyal-labs/rig";
import type { Config, Origin } from "../config.js";
import type { Effort } from "../research/budgets.js";

/** One brief's identity — the SAME string names the fold's document, the browser route
 *  (`/brief/:docId`) and the folder on disk. ISO stamp then a UUID: sortable, URL-safe. */
export type DocId = string;

/** 'deep' is chain-shaped research (each inquiry builds on the last); 'flat' is parallel. */
export type Mode = "flat" | "deep";

/** One settled brief on disk — a library row. `path` is the brief's record, which is what a delete names back. */
export interface LibraryEntry {
  path: string;
  docId: DocId;
  title: string;
  savedAt: string;
  mode: Mode;
  /** What wrote it: a brief reopened months later must not wear the reader's current dial. */
  effort: Effort;
  direct: boolean;
  /** The brief carried images — its record names their roots. */
  hasMedia: boolean;
}

/** A settled brief read whole from its folder: the report and every exchange beside it, in order. */
export interface Thread {
  docId: DocId;
  title: string;
  body: string;
  /** Root manifest digests the report recorded. */
  attachments: string[];
  exchanges: { question: string; body: string; attachments: string[] }[];
  /** The run's own choices, as its record says. */
  mode: Mode;
  effort: Effort;
  direct: boolean;
  /** The whole conversation as one text — what a restore commits to the trunk. */
  thread: string;
}

/** The terminal event's stats payload. Everything optional: research fills its
 *  fields, a passthrough its own. */
export interface CompleteData {
  intent?: string;
  planTokens?: number;
  agentTokens?: number;
  synthTokens?: number;
  /** The settling pass's perplexity, when there was one. */
  synthPpl?: number;
  passthroughTokens?: number;
  totalToolCalls?: number;
  agentCount?: number;
  wallTimeMs?: number;
  planMs?: number;
  researchMs?: number;
  synthMs?: number;
  passthroughMs?: number;
}

// ── Commands ─────────────────────────────────────────────────────

/** The revision names the planning round the interface saw; a stale one is refused with a toast. */
export type BriefCommand =
  | {
      type: "submit_query";
      query: string;
      mode: Mode;
      /** The question IS the plan: one agent answers with every source's tools registered. */
      skipPlanner?: boolean;
      /** ROOT descriptors for content already admitted over the content plane — never bytes.
       *  Untrusted: a claim about content, checked by `admitted` before anything moves. */
      attachments?: Descriptor[];
    }
  | { type: "submit_clarification"; revision: number; answer: string }
  | { type: "accept_plan"; revision: number }
  | { type: "cancel_plan" }
  | { type: "edit_plan"; query: string }
  | { type: "change_mode"; mode: Mode }
  | { type: "update_task_description"; revision: number; index: number; description: string }
  | { type: "add_task"; revision: number; afterIndex: number }
  | { type: "delete_task"; revision: number; index: number }
  | { type: "move_task"; revision: number; from: number; to: number }
  | { type: "toggle_participation"; name: string }
  /** Halt anything live, clear the canvas, return to the picker. */
  | { type: "new_run" }
  /** Navigate the canvas to a brief — view-only, legal during runs. Null is the picker. */
  | { type: "open_doc"; docId: DocId | null };

export type LibraryCommand =
  | { type: "library_list" }
  /** Rank the library against a query with the session reranker; empty clears. Ignored while a run is live. */
  | { type: "library_search"; query: string }
  /** Remove a brief's whole folder. Confined to the library. */
  | { type: "library_delete"; path: string };

export type Command = BriefCommand | LibraryCommand | RunCommand | SettingsCommand<Config> | { type: "quit" };

// ── Events ───────────────────────────────────────────────────────

export type BriefEvent =
  | {
      type: "query";
      /** THE echo — the first event of every accepted ask; mints the brief's identity. */
      docId: DocId;
      query: string;
      /** An ask INTO the settled brief this names. */
      warm: boolean;
      /** A direct ask: the question is the plan. */
      direct?: boolean;
      effort?: Effort;
      attachments?: Descriptor[];
    }
  | { type: "plan:start"; query: string; mode: Mode }
  /** The plan as it stands: said when the planner returns it, and again whenever the reader edits it. */
  | { type: "plan"; intent: PlanIntent; tasks: ResearchTask[]; clarifyQuestions: string[]; tokenCount: number; timeMs: number }
  /** The planner asked; this round's `revision` must come back with the answer. */
  | { type: "ui:clarify"; revision: number }
  /** The plan awaits the reader's yes; this round's `revision` must come back with it and with every edit. */
  | { type: "ui:plan_review"; revision: number }
  | { type: "preflight:start"; query: string; abilityCount: number }
  | { type: "preflight:done"; coverage: string; tokens: number; toolCalls: number; timeMs: number }
  /** The writing began. Said by the brief, so it is said whatever writer it was handed; `reports` is how its
   *  inquiries hand in their findings (rig's `Reports`), so the view can read them as they are written. */
  | { type: "research:start"; agentCount: number; mode: Mode; reports: Reports | null }
  | { type: "research:done"; totalTokens: number; totalToolCalls: number; timeMs: number }
  | { type: "synthesize:start" }
  | { type: "synthesize:done"; agentId: number; ppl: number; tokenCount: number; toolCallCount: number; timeMs: number }
  /** The answer — or null when the inquiries found nothing to settle: the ask is over, nothing was invented,
   *  committed or kept, and the view says so. */
  | { type: "answer"; text: string | null }
  | { type: "stats"; ctxPct: number; ctxPos: number; ctxTotal: number }
  | { type: "complete"; data: CompleteData }
  /** A settled brief, whole, from disk. Does not activate. */
  | { type: "doc"; docId: DocId; title: string; mode: Mode; effort: Effort; direct: boolean; attachments?: Descriptor[]; answer: string; exchanges: { question: string; body: string; attachments: string[] }[] }
  /** What the canvas shows. Null is the picker. */
  | { type: "doc:active"; docId: DocId | null }
  /** The run stopped short of complete. A stillborn brief dies with it; a settled one stands. */
  | { type: "run:aborted" }
  /** Whether a source takes part in the next ask. */
  | { type: "participation:toggled"; name: string; included: boolean }
  /** The session is ready: the model is resident and the abilities are enabled. */
  | { type: "weights:done" };

export type LibraryEvent =
  | { type: "library:list"; entries: LibraryEntry[] }
  /** Report paths ranked against `query`, best first; an empty query clears. */
  | { type: "library:search"; query: string; ranked: string[] }
  /** The corpus ability indexed the library (at boot, and after every settle). */
  | { type: "corpus:indexed"; corpusPath: string; fileCount: number; chunkCount: number };

export type WorkflowEvent = AgentEvent | BriefEvent | LibraryEvent | SettingsEvent<Config, Origin> | HostResourcesEvent;

// ── The small builders ───────────────────────────────────────────

export const docEvent = (thread: Thread, restored: Descriptor[]): Extract<BriefEvent, { type: "doc" }> => ({
  type: "doc",
  docId: thread.docId,
  title: thread.title,
  mode: thread.mode,
  effort: thread.effort,
  direct: thread.direct,
  ...(restored.length > 0 ? { attachments: restored } : {}),
  answer: thread.body,
  exchanges: thread.exchanges,
});

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A one-shot run the harness could not proceed past — rig's: the boot writes its message and exits with its code. */
export { HarnessExit } from "@lloyal-labs/rig";
