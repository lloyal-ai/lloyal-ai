import type { Projection } from "@lloyal-labs/binding";
import type { Command } from "../protocol.js";
import type { AppState } from "./state.js";
const route = /^\/conversation\/([0-9a-f-]+)$/i;
export function installHistory(
  projection: Pick<Projection<AppState>, "getSnapshot" | "subscribe">,
  send: (c: Command) => void,
): () => void {
  const dispatch = () => {
    const id = route.exec(location.pathname)?.[1] ?? null;
    if (id !== projection.getSnapshot().activeId)
      send({ type: "open_conversation", id });
  };
  dispatch();
  addEventListener("popstate", dispatch);
  let prior = projection.getSnapshot().activeId;
  const unsubscribe = projection.subscribe((state) => {
    if (state.activeId === prior) return;
    prior = state.activeId;
    const path = state.activeId ? "/conversation/" + state.activeId : "/";
    if (location.pathname !== path)
      history.pushState(null, "", path + location.search + location.hash);
  });
  return () => {
    removeEventListener("popstate", dispatch);
    unsubscribe();
  };
}
