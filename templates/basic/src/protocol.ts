/**
 * The events this harness emits (↓) and the commands its surfaces send (↑).
 *
 * This union is YOURS — the harness owns it — and it sits beside the vocabulary
 * rig owns. `SettingsEvent` is rig's words for configuration: `config:loaded`,
 * `config:updated`, `abilities:state` and `ui:error`. They are not restated
 * here, because a word restated is a word that can drift.
 *
 * Every target (cli · desktop · web) carries the same events over its binding,
 * and the renderer folds them into UI state via `reduce` (see `ui/state.ts`).
 * Grow these two types as your harness grows; nothing else in the project needs
 * to change when you do.
 *
 * Node-free, so a renderer imports this to speak the protocol without depending
 * on the harness. Types, and the two small values the contract itself owns.
 */
import type { AgentEvent } from "@lloyal-labs/lloyal-agents";
import type { HostResourcesEvent, RunCommand, SettingsEvent } from "@lloyal-labs/rig";

/**
 * The measured facts the boot surface renders — every line a runtime truth, not
 * a hardcoded string: the model's id and the on-disk size of the weight the boot
 * resolved, plus the Abilities actually enabled (read from the registry). The
 * harness emits these on `ready`, so the header is identical in a terminal, an
 * Electron window, or a browser tab.
 *
 * Which surface is mounted is deliberately absent: a renderer knows what it is
 * without being told, so it renders its own name.
 */
export interface BootFacts {
  model: { id: string; sizeBytes: number };
  abilities: string[];
}

export type WorkflowEvent =
  // Forwarded verbatim from the agent pool (spawn / produce / return / …).
  | AgentEvent
  // Dev-gated host samples for the pane's pressure strip (cpu/rss/mem).
  | HostResourcesEvent
  // Rig's own words on configuration: `config:loaded` (the first event every
  // surface folds, ability values redacted to key-presence before it rides any
  // wire), `config:updated`, `abilities:state`, and `ui:error` toasts.
  //
  // Left at rig's base config shape ON PURPOSE. The views read only `dev` off
  // `config:loaded`; naming this app's exact `Config` here would make every
  // renderer's program follow `app.ts`, which is Node code — the boot's, not the
  // browser's. Widen it the day a view genuinely reads a key.
  | SettingsEvent
  // Boot finished — the surface may accept a query. Carries the measured facts.
  | { type: "ready"; facts: BootFacts }
  // A turn began. Emitted BEFORE any work, so the surface knows a new turn
  // started without having to infer it from the first `agent:spawn` — which is
  // both late and unable to tell a new turn's first agent from an extra agent
  // spawned inside the current one. `warm` is true when the session already has
  // a trunk, i.e. this turn DEEPENS the existing article rather than starting a
  // fresh one; the view uses it to decide between replacing and extending.
  | { type: "query"; text: string; warm: boolean }
  // The article for the last query — `null` when the agents found nothing worth settling. The event ALWAYS
  // fires, so a surface never has to infer "the turn is over" from silence; `null` is what it says instead of
  // inventing prose nobody's sources support.
  | { type: "answer"; text: string | null }
  // The turn stopped short of an answer — the reader stopped it, or it failed. Said on its own, because
  // "the run ended badly" and "here is something to show the reader" are two facts: a benign failure
  // toasts through rig's `ui:error` without any turn ending, and a dying run says BOTH.
  | { type: "run:aborted" }
  // What is kept on disk, said at boot and after every turn that keeps something. `groups` is the resident
  // model's grouping of them, `null` until it answers — the list paints flat first and regroups when it does,
  // so nothing on screen ever waits for a model call.
  | { type: "library"; articles: KeptArticle[]; groups: Group[] | null };

/** One kept article, as a surface lists it — the folder name is the identity. */
export interface KeptArticle {
  id: string;
  query: string;
  savedAt: string;
}

/** A topic the model named, and the articles it put under it. */
export interface Group {
  topic: string;
  ids: string[];
}

/**
 * What a surface can ask for. `stop` is rig's word, not this app's — `RunCommand` is rig's whole vocabulary
 * for the controls of a live run (`stop` · `wrap_up` · `pause` · `resume` · `cancel_agent`), and taking one
 * member of it by `Extract` says so out loud while costing exactly one concept. basic offers no control below
 * boot beyond stopping, so it declares no more than it keeps; widen to the whole union the day a surface
 * grows a pause button.
 */
export type Command =
  | { type: "submit_query"; query: string }
  | Extract<RunCommand, { type: "stop" }>
  | { type: "quit" };

/** Any thrown thing as a sentence, for the one place that shows the reader an error. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A one-shot run the harness could not proceed past — rig's: the boot writes its message and exits with its code. */
export { HarnessExit } from "@lloyal-labs/rig";
