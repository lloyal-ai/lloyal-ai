/**
 * The browser side of the web target — installs `window.harness`, the bridge
 * `@lloyal-labs/binding/web` builds over one wss connection, the SAME shape the
 * desktop preload exposes over IPC. The bridge folds the page's own state, so a
 * view that mounts late — a reload, a Fast Refresh mid-run — seeds from its
 * snapshot instead of blanking.
 *
 * It also RETRIES. `binding/web` is deliberately stateless ("the app decides
 * whether to reconnect"), and `npm run dev:web` starts Vite and the model host
 * together: Vite wins that race every time, so the first connection usually
 * fails while the host is still compiling or fetching weights. Without a retry
 * the page sits dead until someone reloads it.
 *
 * What survives a retry is this FACADE. The view holds `window.harness` once, so
 * the object it holds must outlive any one socket; the bridge underneath is
 * replaced. Each replacement starts a new `epoch`, which is exactly what a
 * projection re-seeds on — so a reconnect rebuilds the run rather than
 * interleaving two streams.
 */
import { createBridge } from "@lloyal-labs/binding/web";
import type { Bridge, Frame, SessionState, Snapshot, WireStatus } from "@lloyal-labs/binding";
import { initialState, reduce, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent, Command } from "../../src/protocol.js";

type Inner = Bridge<WorkflowEvent, Command, AppState> & { close(): void };

/** Long enough not to hammer a host that is loading a model, short enough that a
 *  developer who starts `serve` in another shell sees the page come alive. */
const RETRY_MS = 1000;

/** Where the served host lives: build-time `VITE_WSS_URL`, a `?server=` query
 *  param, then the local `npm run serve` default. */
function resolveWssUrl(): string {
  const env = (import.meta as unknown as { env?: { VITE_WSS_URL?: string } }).env?.VITE_WSS_URL;
  if (env) return env;
  return new URLSearchParams(window.location.search).get("server") ?? "ws://127.0.0.1:8787";
}

export function installWebBridge(): void {
  let inner: Inner | null = null;
  let detach: (() => void)[] = [];
  let retry: ReturnType<typeof setTimeout> | null = null;
  let status: WireStatus = "connecting";
  let session: SessionState | null = null;

  const frameCbs = new Set<(frame: Frame<WorkflowEvent>) => void>();
  const statusCbs = new Set<(s: WireStatus) => void>();
  const sessionCbs = new Set<(s: SessionState) => void>();

  const setStatus = (next: WireStatus): void => {
    if (next === status) return;
    status = next;
    for (const cb of statusCbs) cb(status);
  };

  const connect = (): void => {
    const b = createBridge<WorkflowEvent, Command, AppState>(resolveWssUrl(), {
      initialState,
      reduce,
      // A served host cannot re-admit an existing connection, so a working
      // session means a new one — which for this page is a reload.
      recover: () => window.location.reload(),
    });
    inner = b;
    detach = [
      b.onEvent((frame) => {
        for (const cb of frameCbs) cb(frame);
      }),
      b.onStatus?.((s) => {
        setStatus(s);
        if (s === "lost") schedule();
      }) ?? ((): void => {}),
      b.onSession?.((s) => {
        session = s;
        for (const cb of sessionCbs) cb(s);
      }) ?? ((): void => {}),
    ];
  };

  const schedule = (): void => {
    if (retry !== null) return;
    retry = setTimeout(() => {
      retry = null;
      for (const off of detach) off();
      detach = [];
      inner?.close();
      inner = null;
      // Say so before trying: a view that only ever saw `lost` would show a dead
      // page while this is in fact working on it.
      setStatus("connecting");
      connect();
    }, RETRY_MS);
  };

  connect();

  window.harness = {
    onEvent(cb) {
      frameCbs.add(cb);
      return () => {
        frameCbs.delete(cb);
      };
    },
    send(command) {
      inner?.send(command);
    },
    requestSnapshot(): Promise<Snapshot<AppState>> {
      // No socket yet: an empty cut at an epoch no frame can claim, so the
      // projection re-seeds the moment a real one arrives.
      return inner
        ? inner.requestSnapshot()
        : Promise.resolve({ state: initialState, epoch: -1, seq: -1 });
    },
    onStatus(cb) {
      statusCbs.add(cb);
      cb(status);
      return () => {
        statusCbs.delete(cb);
      };
    },
    onSession(cb) {
      sessionCbs.add(cb);
      if (session) cb(session);
      return () => {
        sessionCbs.delete(cb);
      };
    },
    recover: () => window.location.reload(),
  };
}
