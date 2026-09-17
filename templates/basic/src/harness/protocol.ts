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
 * Types only, node-free, so a renderer imports this to speak the protocol
 * without depending on the harness.
 */
import type { AgentEvent } from "@lloyal-labs/lloyal-agents";
import type { HostResourcesEvent, SettingsEvent } from "@lloyal-labs/rig";

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
  // The answer for the last query.
  | { type: "answer"; text: string }
  // A recoverable error to show; the surface returns to accepting input.
  | { type: "error"; message: string };

export type Command =
  | { type: "submit_query"; query: string }
  | { type: "quit" };
