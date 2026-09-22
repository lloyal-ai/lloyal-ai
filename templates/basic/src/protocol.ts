/**
 * The events this harness emits (↓) and the commands its surfaces send (↑).
 *
 * This union is YOURS. Beside it sits the vocabulary rig owns — `SettingsEvent` carries `config:loaded`,
 * `config:updated`, `abilities:state` and `ui:error` — which is included rather than restated.
 *
 * Node-free, so a renderer speaks the protocol without depending on the harness.
 */
import type { AgentEvent } from "@lloyal-labs/lloyal-agents";
import type { HostResourcesEvent, RunCommand, SettingsEvent } from "@lloyal-labs/rig";

/** What the boot header renders: the model as resolved, and the abilities the registry actually enabled.
 *  Which surface is mounted is absent — a renderer knows that without being told. */
export interface BootFacts {
  model: { id: string; sizeBytes: number };
  abilities: string[];
}

export type WorkflowEvent =
  // Forwarded verbatim from the agent pool (spawn / produce / return / …).
  | AgentEvent
  // Dev-gated host samples for the pane's pressure strip (cpu/rss/mem).
  | HostResourcesEvent
  // Rig's own words on configuration. Left at rig's BASE config shape: naming this app's `Config` would make
  // every renderer's program follow `app.ts`, which is Node code. Widen it the day a view reads a key.
  | SettingsEvent
  // Boot finished — the surface may accept a query.
  | { type: "ready"; facts: BootFacts }
  // A turn began, said before any work. `warm` means it DEEPENS the page rather than starting a fresh one.
  | { type: "query"; text: string; warm: boolean }
  // The article, or `null` when the agents found nothing worth settling. ALWAYS fires, so a surface never
  // infers "the turn is over" from silence.
  | { type: "answer"; text: string | null }
  // The turn ended without an answer. Its own event: a benign failure toasts through `ui:error` with no turn
  // ending, and a dying run says both.
  | { type: "run:aborted" }
  // What is kept on disk. `groups` is the model's grouping, `null` until it answers — so the list paints flat
  // and regroups, and nothing on screen waits for a model call. `grouping` says one is under way, which a
  // surface cannot see for itself: the model is asked seconds before its first agent exists.
  | { type: "library"; articles: KeptArticle[]; groups: Group[] | null; grouping: boolean }
  // A kept article, whole, from disk. Does not activate: what the page shows is `doc:active`'s to say.
  | { type: "doc"; docId: DocId; title: string; answer: string }
  // What the page shows. Null is the landing.
  | { type: "doc:active"; docId: DocId | null };

/** One kept article's identity — the name of the folder it is kept in. */
export type DocId = string;

/** One kept article, as a surface lists it. */
export interface KeptArticle {
  docId: DocId;
  query: string;
  savedAt: string;
}

/** A topic the model named, and the articles it put under it. */
export interface Group {
  topic: string;
  docIds: DocId[];
}

/** What a surface can ask for. `stop` is rig's word — one member of `RunCommand`, taken by `Extract` so the
 *  spelling says whose vocabulary it is. Widen to the whole union the day a surface grows a pause button. */
export type Command =
  | { type: "submit_query"; query: string }
  /** Put a kept article on the page, or with null go to the landing. A question deepens whatever is shown.
   *  Ignored while a turn is running: that turn is writing the page. */
  | { type: "open_doc"; docId: DocId | null }
  | Extract<RunCommand, { type: "stop" }>
  | { type: "quit" };

/** Any thrown thing as a sentence, for the one place that shows the reader an error. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A one-shot run the harness could not proceed past — the boot writes its message and exits with its code. */
export { HarnessExit } from "@lloyal-labs/rig";
