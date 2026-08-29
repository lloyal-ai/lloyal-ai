/**
 * The browser side of the web target — installs a `window.harness` bridge backed
 * by `connectWss`, the SAME shape the desktop preload exposes over IPC. That's
 * why the shared React view (`../_shared/App.tsx`) is transport-agnostic: it only
 * reads `window.harness`, whether that's IPC (desktop) or wss (web).
 */
import { connectWss, type WssClient } from "@lloyal-labs/binding/web";
import { initialState, type AppState, type WireStatus } from "../../harness/state.js";
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
  // Transport status, reported to the view so a dropped host degrades
  // VISIBLY (a banner) instead of the whole UI silently going quiet. A
  // deliberate teardown (last listener unsubscribing on HMR / unmount) is
  // NOT a loss — the flag distinguishes it from the socket dying under us.
  let status: WireStatus = "connecting";
  let deliberate = false;
  const statusListeners = new Set<(s: WireStatus) => void>();
  const setStatus = (next: WireStatus): void => {
    if (next === status) return;
    status = next;
    for (const l of statusListeners) l(status);
  };
  // Commands queue until the server says ready: a send while the socket is
  // still CONNECTING throws inside the client and latches it closed — one
  // eager send (the view lists the library on mount) would silence every
  // send after it. Same replay-until-consumer contract the event bus keeps,
  // pointed the other way.
  let ready = false;
  let queued: Command[] = [];
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
        onReady: () => {
          ready = true;
          setStatus("connected");
          const drained = queued;
          queued = [];
          for (const c of drained) client?.send(c);
        },
        onClose: () => {
          // The socket is gone — `ready` must go with it, or send() would
          // bypass the queue and post to a dead link. Commands now queue
          // again (drained if a reconnect ever lands). A deliberate teardown
          // has no one to tell (the view is unmounting); an unexpected drop
          // raises the banner.
          ready = false;
          if (!deliberate) setStatus("lost");
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
          deliberate = true;
          client?.close();
          client = null;
          ready = false;
          queued = [];
          seq = 0;
          history = [];
          // Reset for the next subscription's fresh session.
          deliberate = false;
          status = "connecting";
        }
      };
    },
    send(command: Command): void {
      if (client && ready) client.send(command);
      else queued.push(command);
    },
    // Transport status for the view's connection banner. Fires the current
    // status immediately (like onEvent's replay), then on every change.
    onStatus(cb: (s: WireStatus) => void): () => void {
      statusListeners.add(cb);
      cb(status);
      return () => statusListeners.delete(cb);
    },
    // The wss stream carries no snapshot — start from initialState at seq 0.
    requestSnapshot(): Promise<{ state: AppState; seq: number }> {
      return Promise.resolve({ state: initialState, seq: 0 });
    },
  };

  (window as unknown as { harness: typeof api }).harness = api;
}
