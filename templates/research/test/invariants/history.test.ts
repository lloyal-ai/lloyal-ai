/**
 * URL ⇄ document identity — the pure half. A malformed deep link is an
 * unknown route, never a crash: `decodeURIComponent` throws on a bad
 * percent escape, and the adapter runs at startup and on every popstate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docIdFromPath, pathFor, installHistory } from "../../src/ui/history.js";
import type { AppState } from "../../src/ui/state.js";

test("a malformed percent escape is an unknown route, not a throw", () => {
  assert.equal(docIdFromPath("/brief/%"), null);
  assert.equal(docIdFromPath("/brief/%E0%A4%A"), null);
});

test("well-formed ids round-trip through pathFor", () => {
  for (const id of ["2026-01-01T00-00-00-000", "2026-01-01T00-00-00-000-0f0f0f0f-0000-4000-8000-000000000000", "a b", "x/y"]) {
    assert.equal(docIdFromPath(pathFor(id)), id);
  }
  assert.equal(docIdFromPath("/"), null);
});

test("activating a document keeps the remote endpoints on the URL", () => {
  // The web bridge finds `?server=` and `?content=` on reload; a document
  // change must not drop them (the 2026-09-12 release review, R11).
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { location: g.location, history: g.history, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener };
  const pushed: string[] = [];
  g.location = { pathname: "/", search: "?server=wss%3A%2F%2Fh%3A1&content=https%3A%2F%2Fh%3A2", hash: "#top" };
  g.history = { pushState: (_s: unknown, _t: string, url: string) => { pushed.push(url); } };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  try {
    let listener: ((app: AppState) => void) | null = null;
    const projection = {
      getSnapshot: () => ({ activeDocId: null } as AppState),
      subscribe: (cb: (app: AppState) => void) => { listener = cb; return () => { listener = null; }; },
    };
    const unsub = installHistory(projection, () => {});
    listener!({ activeDocId: "2026-01-01T00-00-00-000-0f0f0f0f-0000-4000-8000-000000000000" } as AppState);
    assert.deepEqual(pushed, [
      "/brief/2026-01-01T00-00-00-000-0f0f0f0f-0000-4000-8000-000000000000?server=wss%3A%2F%2Fh%3A1&content=https%3A%2F%2Fh%3A2#top",
    ]);
    unsub();
  } finally {
    Object.assign(g, saved);
  }
});
