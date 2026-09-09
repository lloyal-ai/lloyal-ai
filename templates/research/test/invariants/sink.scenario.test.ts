/**
 * The run-dir sink's lifecycle is the run's lifecycle — nothing else.
 *
 * `run:aborted` is the one abort signal on the wire, so it is the one the
 * sink resets on; a benign `ui:error` is a toast and must leave a live run's
 * artifacts alone. And a settle is a library change: the harness that wrote
 * the report says so on the wire, whichever document the canvas is viewing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { runHarness, docIdOfQuery } from "./harness.js";

const PLAN_JSON = JSON.stringify({
  intent: "research",
  tasks: [{ description: "investigate the topic" }],
  clarifyQuestions: [],
});

test("an aborted warm ask does not leak its mode: the next cold brief lands as report.md", async () => {
  const run = await runHarness({
    utterances: [
      { text: "A settled.", kind: "text" },
      { text: "never finishes", kind: "text", stallTokens: 2000 },   // the warm ask, stopped
      { text: "C settled.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "A?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete",
        send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      // The warm echo means the ask is live on A's thread; stop it there.
      { on: (ev) => ev.type === "query" && (ev as { warm: boolean }).warm === true,
        send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted", send: { type: "new_run" } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === null,
        send: { type: "submit_query", query: "C?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const c = path.join(run.outputDir, docIdOfQuery(run.events, 2));
  assert.ok(fs.existsSync(path.join(c, "report.md")), "C is a document of its own: report.md");
  assert.ok(!fs.existsSync(path.join(c, "exchange-1.md")), "not an exchange on a dead thread");
});

test("a benign ui:error mid-run is a toast: the run still settles and writes its report", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "findings", kind: "report", stallTokens: 400 },
      { text: "Settled answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: { type: "accept_plan" } },
      // Mid-research, a config path that does not exist: the handler toasts and returns.
      { on: (ev) => ev.type === "research:start",
        send: { type: "set_ability_config", name: "corpus", values: { corpusPath: "/no/such/dir" } } },
      { on: (ev) => ev.type === "ui:error" },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 0);
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  assert.ok(fs.existsSync(path.join(dir, "report.md")), "the toast did not cost the report");
});

test("a settle announces the library change from the harness, unasked", async () => {
  const run = await runHarness({
    utterances: [{ text: "Settled answer.", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const completeAt = run.events.findIndex((e) => e.type === "complete");
  assert.ok(completeAt >= 0);
  const listed = run.events.findIndex((e, i) => i > completeAt && e.type === "library:list");
  assert.ok(listed > completeAt, "library:list follows complete without a library_list command");
});
