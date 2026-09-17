/**
 * The browser side of the web target — installs `window.harness`, the bridge
 * `@lloyal-labs/binding/web` builds over one wss connection, the SAME shape the
 * desktop preload exposes over IPC. The bridge folds the page's own state, so a
 * view that mounts late — a reload, a Fast Refresh mid-run — seeds from its
 * snapshot instead of blanking. What this file decides is only WHERE the host is.
 */
import { createBridge } from "@lloyal-labs/binding/web";
import { initialState, reduce, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent, Command } from "../../src/harness/protocol.js";

/** Where the served host lives: build-time `VITE_WSS_URL`, a `?server=` query
 *  param, then the local `npm run serve` default. */
function resolveWssUrl(): string {
  const env = (import.meta as unknown as { env?: { VITE_WSS_URL?: string } }).env?.VITE_WSS_URL;
  if (env) return env;
  return new URLSearchParams(window.location.search).get("server") ?? "ws://127.0.0.1:8787";
}

export function installWebBridge(): void {
  window.harness = createBridge<WorkflowEvent, Command, AppState>(resolveWssUrl(), {
    initialState,
    reduce,
    // A served host cannot re-admit an existing connection, so a working session
    // means a new one — which for this page is a reload.
    recover: () => window.location.reload(),
  });
}
