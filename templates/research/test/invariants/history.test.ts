/**
 * URL ⇄ document identity — the pure half. A malformed deep link is an
 * unknown route, never a crash: `decodeURIComponent` throws on a bad
 * percent escape, and the adapter runs at startup and on every popstate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docIdFromPath, pathFor } from "../../targets/web/history.js";

test("a malformed percent escape is an unknown route, not a throw", () => {
  assert.equal(docIdFromPath("/brief/%"), null);
  assert.equal(docIdFromPath("/brief/%E0%A4%A"), null);
});

test("well-formed ids round-trip through pathFor", () => {
  for (const id of ["2026-01-01T00-00-00-000", "a b", "x/y"]) {
    assert.equal(docIdFromPath(pathFor(id)), id);
  }
  assert.equal(docIdFromPath("/"), null);
});
