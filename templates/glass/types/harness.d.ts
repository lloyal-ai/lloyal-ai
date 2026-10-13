/**
 * `window.harness` — the bridge the target's boot installs before the view
 * mounts: the web target's `createBridge` over one wss connection, or the
 * desktop preload's over IPC. The view never reads it; it is handed to
 * `HarnessProvider` at the entry, and every component reads the provider.
 */
import type { Bridge } from "@lloyal-labs/binding";
import type { Command, WorkflowEvent } from "../src/protocol.js";
import type { AppState } from "../src/ui/state.js";

declare global {
  interface Window {
    harness: Bridge<WorkflowEvent, Command, AppState>;
  }
}
