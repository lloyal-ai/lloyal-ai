/**
 * The browser side of the web target — installs a `window.harness` bridge backed
 * by `connectWss`, the SAME shape the desktop preload exposes over IPC. That's
 * why the shared React view (`../_shared/App.tsx`) is transport-agnostic: it only
 * reads `window.harness`, whether that's IPC (desktop) or wss (web).
 */
import { connectWss, type WssClient } from "@lloyal-labs/binding/web";
import { initialState, type AppState } from "../../harness/state.js";
import type { WorkflowEvent, Command } from "../../harness/protocol.js";

/** Where the served host lives: build-time `VITE_WSS_URL`, a `?server=` query
 *  param, then the local `npm run serve` default. */
function resolveWssUrl(): string {
  const env = (import.meta as unknown as { env?: { VITE_WSS_URL?: string } }).env?.VITE_WSS_URL;
  if (env) return env;
  const q = new URLSearchParams(window.location.search).get("server");
  if (q) return q;
  return "ws://127.0.0.1:8787";
}

/** Frames kept for replay. A session is one conversation; produce frames are
 *  tiny, so a generous cap covers long runs while bounding a pathological
 *  session. */
const MAX_HISTORY = 50_000;

export function installWebBridge(): void {
  let client: WssClient<Command> | null = null;
  let seq = 0;
  // The session's frame log. A view remount mid-run — fast refresh of
  // App.tsx, the one file a dev edits while a run streams — subscribes LATE;
  // replaying the log through the view's normal seed path rebuilds the run
  // instead of blanking it. This is the bridge's job because this module
  // survives view edits; state kept in the view dies with the edit.
  let history: { seq: number; ev: WorkflowEvent }[] = [];
  const listeners = new Set<(f: { seq: number; ev: WorkflowEvent }) => void>();

  const api = {
    onEvent(cb: (f: { seq: number; ev: WorkflowEvent }) => void): () => void {
      listeners.add(cb);
      // Lazy-connect on first subscription (the view subscribes in its effect).
      // Synthesize a monotonic seq the wire doesn't carry.
      client ??= connectWss<WorkflowEvent, Command>(resolveWssUrl(), {
        onEvent: (ev) => {
          const frame = { seq: ++seq, ev };
          history.push(frame);
          // Amortized: one splice per MAX_HISTORY/2 events, not an O(n)
          // shift per event once the cap is hit. Same drop-oldest semantics.
          if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY / 2);
          for (const l of listeners) l(frame);
        },
      });
      // Replay the session so far to the new subscriber — synchronously,
      // before any live frame, so seq order holds.
      for (const f of history) cb(f);
      return () => {
        listeners.delete(cb);
        // Last listener gone (view unmount / HMR): close the socket so it isn't
        // leaked, and reset — a later subscription reconnects a fresh session
        // (which re-seeds from initialState @ 0, matching requestSnapshot).
        if (listeners.size === 0) {
          client?.close();
          client = null;
          seq = 0;
          history = [];
        }
      };
    },
    send(command: Command): void {
      client?.send(command);
    },
    // The wss stream carries no snapshot — start from initialState at seq 0.
    requestSnapshot(): Promise<{ state: AppState; seq: number }> {
      return Promise.resolve({ state: initialState, seq: 0 });
    },
  };

  (window as unknown as { harness: typeof api }).harness = api;
}
