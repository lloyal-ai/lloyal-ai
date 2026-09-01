/**
 * The browser side of the web target — installs a `window.harness` bridge backed
 * by `connectWss`, the SAME shape the desktop preload exposes over IPC. That's
 * why the shared React view (`../_shared/App.tsx`) is transport-agnostic: it only
 * reads `window.harness`, whether that's IPC (desktop) or wss (web).
 */
import { connectWss, type WssClient } from "@lloyal-labs/binding/web";
import { initialState, type AppState, type WireStatus } from "../../harness/state.js";
import type { WorkflowEvent, Command } from "../../harness/protocol.js";
import type { Descriptor } from "@lloyal-labs/media";

const DEFAULT_WSS = "ws://127.0.0.1:8787";

/** An explicitly-configured host, or null for "wherever this page came from":
 *  build-time `VITE_WSS_URL` first, then a `?server=` query param. */
function configuredWssUrl(): string | null {
  const env = (import.meta as unknown as { env?: { VITE_WSS_URL?: string } }).env?.VITE_WSS_URL;
  if (env) return env;
  return new URLSearchParams(window.location.search).get("server");
}

/** Where the served host lives. */
function resolveWssUrl(): string {
  return configuredWssUrl() ?? DEFAULT_WSS;
}

/**
 * Base URL for the content plane — HTTP carries bytes, the socket carries
 * references to them.
 *
 * Never derived from `window.location`: the page is on :5173 in dev while the
 * host is on :8787, and the host is remote-capable. The default is RELATIVE so
 * Vite's proxy keeps dev same-origin; an explicitly-pointed host derives its
 * origin from the socket URL, so `?server=` moves both planes together and they
 * cannot drift apart.
 */
function resolveContentBaseUrl(): string {
  const env = (import.meta as unknown as { env?: { VITE_CONTENT_URL?: string } }).env?.VITE_CONTENT_URL;
  const explicit = env ?? new URLSearchParams(window.location.search).get("content");
  if (explicit) return explicit.replace(/\/$/, "");
  const wss = configuredWssUrl();
  if (!wss) return "";
  try {
    const u = new URL(wss);
    u.protocol = u.protocol === "wss:" ? "https:" : "http:";
    return u.origin;
  } catch {
    // An unparsable override is a config error, not a reason to fetch bytes
    // from a different host than the one commands go to.
    return "";
  }
}

/** Resolves THROUGH the manifest, so a retained source layer can never be
 *  served in place of the copy the projector actually encoded. */
export function representationUrl(digest: string, index = 0): string {
  return `${resolveContentBaseUrl()}/v1/media/${encodeURIComponent(digest)}/representations/${index}`;
}

/**
 * Admit an image and get back its ROOT descriptor.
 *
 * The host decides what "admitted" means — normalize, address, commit — and
 * hands back a reference. The browser never learns the digest of what it
 * uploaded: normalization changes the bytes, and the root is the manifest's
 * hash, not the file's.
 */
export async function ingestMedia(bytes: Uint8Array): Promise<Descriptor> {
  const res = await fetch(`${resolveContentBaseUrl()}/v1/media/ingress`, {
    method: "POST",
    // No `Content-Type`: the bytes answer that question, and the route stopped
    // reading the header precisely because a client cannot be the authority on
    // content it did not produce.
    body: bytes as BodyInit,
  });
  if (!res.ok) {
    // The route answers 413 too large, 408 too slow, 400 not admitted, 501 no
    // ingress installed. Its message beats anything invented here.
    throw new Error((await res.text().catch(() => "")) || `upload failed (${res.status})`);
  }
  return (await res.json()) as Descriptor;
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
    // Here, not in the view: which plane serves bytes is a transport fact.
    representationUrl(digest: string, index = 0): string {
      return representationUrl(digest, index);
    },
    ingestMedia(bytes: Uint8Array): Promise<Descriptor> {
      return ingestMedia(bytes);
    },
  };

  (window as unknown as { harness: typeof api }).harness = api;
}
