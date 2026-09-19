/**
 * `window.harness` — the bridge the target's boot installs before the view
 * mounts: the web target's `createBridge` over one wss connection, or the
 * desktop preload's over IPC. One shape, two transports, so the React view is
 * transport-agnostic and both surfaces reuse it.
 */
import type { Bridge } from "@lloyal-labs/binding";
import type { Command, WorkflowEvent } from "../src/harness/protocol.js";
import type { AppState } from "../src/ui/state.js";

declare global {
  interface Window {
    harness: Bridge<WorkflowEvent, Command, AppState>;
  }
}
