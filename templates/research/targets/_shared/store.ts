/** The bridge, folded once. One Zustand store per bridge holds the same
 *  `AppState` every target folds (`harness/state.ts`); components read it
 *  through the selectors in `select.ts` and never touch events directly.
 *
 *  The subscription is snapshot-safe: subscribe FIRST so no frame is missed,
 *  buffer until the snapshot lands, then fold buffered frames newer than the
 *  cut. A frame at or below the seen `seq` is a replay and is dropped. An
 *  unreachable snapshot seeds from `initialState` so the stream never stalls.
 *  The store is a per-bridge singleton — a remount reattaches, it never
 *  re-subscribes or resets. */
import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { reduce, initialState, type AppState, type WireStatus } from "../../harness/state.js";
import type { WorkflowEvent, Command } from "../../harness/protocol.js";

export interface Bridge {
  onEvent(cb: (frame: { seq: number; ev: WorkflowEvent }) => void): () => void;
  send(command: Command): void;
  requestSnapshot(): Promise<{ state: AppState; seq: number }>;
  /** Transport status, when the bridge has a droppable link (web/wss). The
   *  in-process bridges (cli, desktop-ipc) omit it — the view then treats
   *  the link as permanently 'connected' and never shows the banner. */
  onStatus?(cb: (status: WireStatus) => void): () => void;
}

declare global {
  interface Window {
    /** Injected by the target's boot: desktop's preload (contextBridge over
     *  IPC) or web's `connectWss` — the view never knows which. */
    harness: Bridge;
  }
}

type Frame = { seq: number; ev: WorkflowEvent };
type BriefStore = ReturnType<typeof connect>;

function connect(bridge: Bridge) {
  const store = createStore<{ app: AppState }>(() => ({ app: initialState }));
  let seq = -1;
  let seeded = false;
  const pending: Frame[] = [];

  const fold = (frame: Frame): void => {
    if (frame.seq <= seq) return;
    seq = frame.seq;
    store.setState((s) => ({ app: reduce(s.app, frame.ev) }));
  };

  const seed = (base: AppState, baseSeq: number): void => {
    if (seeded) return;
    seeded = true;
    let app = base;
    seq = baseSeq;
    for (const frame of pending) {
      if (frame.seq <= seq) continue;
      seq = frame.seq;
      app = reduce(app, frame.ev);
    }
    pending.length = 0;
    store.setState({ app });
  };

  bridge.onEvent((frame) => (seeded ? fold(frame) : pending.push(frame)));
  bridge
    .requestSnapshot()
    .then((snap) => seed(snap.state, snap.seq))
    .catch(() => seed(initialState, -1));

  return store;
}

const stores = new WeakMap<Bridge, BriefStore>();

function storeFor(bridge: Bridge): BriefStore {
  let store = stores.get(bridge);
  if (!store) {
    store = connect(bridge);
    stores.set(bridge, store);
  }
  return store;
}

/** Read a derivation of the folded state. Results are memoized per fold —
 *  the state is immutable between events, so a named selector returns the
 *  SAME reference until the next fold (what `useSyncExternalStore` needs).
 *  The contract: selectors from `select.ts` (stable identity) may build
 *  objects; an inline selector must return a primitive. A component that
 *  re-renders on its OWN timer hoists its selectors — a fresh identity per
 *  tick would grow the fold's memo map. */
const derived = new WeakMap<AppState, Map<(app: AppState) => unknown, unknown>>();

export function useBrief<T>(select: (app: AppState) => T): T {
  return useStore(storeFor(window.harness), (s) => {
    let memo = derived.get(s.app);
    if (!memo) {
      memo = new Map();
      derived.set(s.app, memo);
    }
    if (!memo.has(select)) memo.set(select, select(s.app));
    return memo.get(select) as T;
  });
}

/** Dispatch a command to the harness. */
export const send = (command: Command): void => window.harness.send(command);

/** The transport link's status, for the connection banner. A bridge without
 *  `onStatus` (cli, desktop-ipc — no droppable socket) reads 'connected'
 *  forever, so the banner is web-only without a line of per-target code.
 *  The one subscription updates the snapshot AND notifies, so getSnapshot
 *  never reads a stale value. */
let lastStatus: WireStatus = "connected";
export function useConnection(): WireStatus {
  return useSyncExternalStore(
    (notify) =>
      window.harness.onStatus?.((s) => { lastStatus = s; notify(); }) ?? (() => {}),
    () => lastStatus,
    () => "connected",
  );
}
