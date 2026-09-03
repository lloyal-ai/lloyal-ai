/** URL ⇄ document identity. '/' is the picker; '/brief/<docId>' is that
 *  document. One direction folds the URL into a command (popstate →
 *  open_doc); the other mirrors activeDocId out (subscribe → pushState).
 *  Both guard on already-matching, so neither can echo the other. The URL
 *  is derived state — a pure projection of the fold's activeDocId with a
 *  command as its only write path. Lifecycle never rides the URL. */
import type { Command } from "../../harness/protocol.js";
import type { AppState, DocId } from "../../harness/state.js";

const DOC_ROUTE = /^\/brief\/([^/]+)$/;

export const docIdFromPath = (path: string): DocId | null => {
  const m = DOC_ROUTE.exec(path);
  if (!m) return null;
  // A malformed percent escape is an unknown route, not a crash: this runs at
  // startup and on every popstate, from whatever URL the browser holds.
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
};

export const pathFor = (docId: DocId | null): string =>
  docId === null ? "/" : `/brief/${encodeURIComponent(docId)}`;

export function installHistory(
  store: {
    getState(): { app: AppState };
    subscribe(cb: (s: { app: AppState }) => void): () => void;
  },
  send: (c: Command) => void,
): () => void {
  // URL → fold: the initial deep link and every back/forward is a command;
  // the harness answers with doc/doc:active and the fold moves. Never touch
  // state here. A cold deep link queues in the bridge until the host is
  // ready; an unknown id toasts and the mirror below settles the URL to '/'.
  const dispatch = (): void => {
    const docId = docIdFromPath(location.pathname);
    if (docId !== store.getState().app.activeDocId) send({ type: "open_doc", docId });
  };
  dispatch(); // deep link on load
  addEventListener("popstate", dispatch);

  // fold → URL: mirror activeDocId. pushState only when the path actually
  // differs — a popstate-initiated activation already matches and pushes
  // nothing, so the history stack never gains echo entries.
  const unsub = store.subscribe((s) => {
    const path = pathFor(s.app.activeDocId);
    if (location.pathname !== path) history.pushState(null, "", path);
  });

  return () => {
    removeEventListener("popstate", dispatch);
    unsub();
  };
}
