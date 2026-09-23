/**
 * The browser side of the web target — installs `window.harness`, the bridge
 * `@lloyal-labs/binding/web` builds over one wss connection, the SAME shape the
 * desktop preload exposes over IPC. The bridge folds the page's own state, so a
 * view that mounts late seeds from its snapshot; what this file decides is
 * only WHERE: the host, and the content plane's origin.
 */
import { createBridge } from "@lloyal-labs/binding/web";
import { initialState, reduce, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent, Command } from "../../src/protocol.js";

/** Where the host is, when nothing points this page elsewhere. The bundler resolves it from the
 *  same `.env` the host reads, so a port written once moves both ends of the socket; the literal
 *  is only for a build that defines nothing. */
declare const __DEFAULT_WSS__: string | undefined;
const DEFAULT_WSS = typeof __DEFAULT_WSS__ === "string" ? __DEFAULT_WSS__ : "ws://127.0.0.1:8787";

/** An explicitly-configured host, or null for "wherever this page came from".
 *  Build-time `VITE_WSS_URL` first, then a `?server=` query param. */
function configuredWssUrl(): string | null {
  const env = (import.meta as unknown as { env?: { VITE_WSS_URL?: string } }).env?.VITE_WSS_URL;
  if (env) return env;
  return new URLSearchParams(window.location.search).get("server");
}

/**
 * Base URL for the content plane — HTTP carries bytes, the socket carries
 * references. Never derived from `window.location`: the page is on :5173 in
 * dev while the host is on its own port, and the host is remote-capable. The default
 * is RELATIVE so Vite's proxy keeps dev same-origin; an explicitly-pointed host
 * derives its origin from the socket URL, so `?server=` moves both planes.
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
    return "";
  }
}

export function installWebBridge(): void {
  window.harness = createBridge<WorkflowEvent, Command, AppState>(configuredWssUrl() ?? DEFAULT_WSS, {
    initialState,
    reduce,
    contentOrigin: resolveContentBaseUrl(),
    // A served host cannot re-admit an existing connection, so a working session means a new one.
    recover: () => window.location.reload(),
  });
}
