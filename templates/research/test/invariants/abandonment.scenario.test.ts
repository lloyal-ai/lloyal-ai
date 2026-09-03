/**
 * Abandoning a run — the law is the stillborn/standing rule: an abort keeps
 * only what was finished before the run started, and the WIRE must hear
 * `run:aborted` so the fold can apply it.
 *
 * Every abandonment path announces: `stop`, `submit_query` over a live
 * run, and `new_run` all compose the same `abortRun()` — halt, clear the
 * park, remove a stillborn's orphan run dir, announce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runHarness, warmDeltas, docIdOfQuery, writeReportFixture,
} from "./harness.js";

const PLAN_JSON = JSON.stringify({
  intent: "research",
  tasks: [{ description: "investigate the topic" }],
  clarifyQuestions: [],
});

test("stop mid-run: the wire hears run:aborted (the one complete implementation)", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "never finishes", kind: "report", stallTokens: 2000 },
    ],
    script: [
      { send: { type: "submit_query", query: "A?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: { type: "accept_plan" } },
      { on: (ev) => ev.type === "research:start" },
      { on: (ev) => ev.type === "agent:produce", send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1);
  assert.equal(run.events.filter((e) => e.type === "complete").length, 0);
});

test("submit from another doc DURING a run: the death is ANNOUNCED before the new echo", async () => {
  let aDocId: string | null = null;
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, "2026-01-01T00-00-00-000", "Doc B", "B's settled body."),
    utterances: [
      { text: PLAN_JSON, kind: "text" },                                  // A's planner
      { text: "never finishes", kind: "report", stallTokens: 2000 },      // A's agent, interrupted
      { text: "B's warm answer.", kind: "text" },                         // B's ask agent
    ],
    script: [
      { send: { type: "submit_query", query: "A?", mode: "flat" } },
      // A matcher runs only while its step is CURRENT — A's query flows by
      // while this first wait is live, so the id capture rides here.
      { on: (ev) => {
          if (ev.type === "query" && aDocId === null) aDocId = (ev as { docId: string }).docId;
          return ev.type === "ui:plan_review";
        },
        send: { type: "accept_plan" } },
      { on: (ev) => ev.type === "research:start" },
      // Interrupt only once A's agent is STREAMING — the utterance queue
      // assigns by sample order, and a pre-sample halt would hand A's
      // stalled script to B's agent.
      { on: (ev) => ev.type === "agent:produce", send: { type: "open_doc", docId: "2026-01-01T00-00-00-000" } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === "2026-01-01T00-00-00-000",
        send: { type: "submit_query", query: "ask into B", mode: "flat", skipPlanner: true } },
      // After B settles, revisit the dead A: the harness must have FORGOTTEN
      // it — the honest toast, never a doc:active into a document that
      // exists nowhere (the ghost shell).
      { on: (ev) => ev.type === "complete",
        send: () => ({ type: "open_doc", docId: aDocId! }) },
      { on: (ev) => ev.type === "ui:error" && /no longer there/.test((ev as { message: string }).message) },
    ],
  });

  // B's side is fully correct: a warm ask into the reopened identity, the
  // banked thread first, its answer second, one trunk.
  const bQuery = run.events.filter((e) => e.type === "query")
    .find((e) => (e as { docId: string }).docId === "2026-01-01T00-00-00-000") as { warm: boolean };
  assert.equal(bQuery.warm, true);
  const deltas = warmDeltas(run.trace);
  assert.ok(deltas[0].content?.includes("B's settled body."));
  assert.ok(deltas[1].content?.includes("B's warm answer."));
  assert.equal(deltas[1].branchHandle, deltas[0].branchHandle);

  // A died: exactly one complete on the wire (B's), and A never settled —
  // its stillborn run dir is removed with it (the fold forgets the doc, so
  // the disk must not remember it).
  assert.equal(run.events.filter((e) => e.type === "complete").length, 1);
  assert.equal(aDocId, docIdOfQuery(run.events, 0), "the captured id IS A's");
  assert.ok(!fs.existsSync(path.join(run.outputDir, aDocId!)), "A's orphan dir is removed");

  // The law: A's death is announced BEFORE B's echo, so the fold applies
  // its stillborn rule before the new document is born.
  const types = run.events.map((e) => e.type);
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1);
  const bQueryIdx = run.events.findIndex(
    (e) => e.type === "query" && (e as { docId: string }).docId === "2026-01-01T00-00-00-000",
  );
  assert.ok(types.indexOf("run:aborted") < bQueryIdx, "announced before the new echo");
});

test("new_run DURING a run: halts to the picker, announced", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "never finishes", kind: "report", stallTokens: 2000 },
    ],
    script: [
      { send: { type: "submit_query", query: "A?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: { type: "accept_plan" } },
      { on: (ev) => ev.type === "research:start" },
      { on: (ev) => ev.type === "agent:produce", send: { type: "new_run" } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === null },
    ],
  });

  // The picker arrived; the run never settled; the death was announced.
  assert.equal(run.events.filter((e) => e.type === "complete").length, 0);
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1);
});

test("a benign ui:error is a toast only — a settled document is untouched", async () => {
  const run = await runHarness({
    utterances: [{ text: "Settled answer.", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete",
        // A config path that does not exist — the handler toasts and returns;
        // it must not abort the settled document sitting in the fold.
        send: { type: "set_ability_config", name: "corpus", values: { corpusPath: "/no/such/dir" } } },
      { on: (ev) => ev.type === "ui:error" },
    ],
  });
  // The failure toasted; NO run:aborted rode with it.
  assert.equal(run.events.filter((e) => e.type === "ui:error").length, 1);
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 0);
});
