/**
 * Navigation is view-only: `open_doc` moves the canvas and NEVER touches the
 * KV — the lazy commit belongs to the first submit. The three arms: a doc on
 * disk (upsert + activate), an unknown id (an honest toast), and null (the
 * picker).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, warmDeltas, writeReportFixture } from "./harness.js";

test("open_doc: disk doc upserts + activates; unknown id toasts; null is the picker — zero KV", async () => {
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, "2026-01-01T00-00-00-000", "Saved brief", "The saved body."),
    script: [
      { send: { type: "open_doc", docId: "2026-01-01T00-00-00-000" } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === "2026-01-01T00-00-00-000",
        send: { type: "open_doc", docId: "not-a-doc" } },
      { on: (ev) => ev.type === "ui:error", send: { type: "open_doc", docId: null } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === null },
    ],
  });

  // The doc arrived whole, before its activation.
  const doc = run.events.find((e) => e.type === "doc") as
    | { docId: string; title: string; answer: string }
    | undefined;
  assert.ok(doc, "doc upsert emitted");
  assert.equal(doc.title, "Saved brief");
  assert.ok(doc.answer.includes("The saved body."));
  const types = run.events.map((e) => e.type);
  assert.ok(types.indexOf("doc") < types.indexOf("doc:active"));

  // The unknown id said so plainly.
  const err = run.events.find((e) => e.type === "ui:error") as { message: string };
  assert.match(err.message, /no longer there/);

  // View-only means view-only: no trunk commit, ever.
  assert.equal(warmDeltas(run.trace).length, 0);
});

test("reopen + first ask: the thread banks lazily — commit at submit, not at navigation", async () => {
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, "2026-01-01T00-00-00-000", "Saved brief", "The saved body."),
    utterances: [{ text: "Warm answer over the reopened thread.", kind: "text" }],
    script: [
      { send: { type: "open_doc", docId: "2026-01-01T00-00-00-000" } },
      { on: (ev) => ev.type === "doc:active",
        send: { type: "submit_query", query: "A follow-up?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  // The ask is warm INTO the reopened identity.
  const query = run.events.find((e) => e.type === "query") as { docId: string; warm: boolean };
  assert.equal(query.docId, "2026-01-01T00-00-00-000");
  assert.equal(query.warm, true);

  // TWO commits, one trunk: the banked thread first (the reopened report is
  // the warmup), then the settled exchange.
  const deltas = warmDeltas(run.trace);
  assert.equal(deltas.length, 2);
  assert.ok(deltas[0].content?.includes("The saved body."), "the reopened thread banked first");
  assert.ok(deltas[1].content?.includes("Warm answer"), "the ask settled second");
  assert.equal(deltas[1].branchHandle, deltas[0].branchHandle);
});
