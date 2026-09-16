/**
 * The execution owner at the seam: one live operation per session, and what the
 * rest of the harness may do beside it. The laws: library search is refused
 * while a run is live and served once it has settled; an ability's settings are
 * refused while a run is live; a change of output directory takes effect for the
 * next brief; `open_doc` during a run moves the canvas and touches no KV.
 *
 * What poisoning does to the owner is the framework's law, not this app's, and
 * forcing it means reaching into a private SDK method. It lives with the owner,
 * in the framework's own suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runHarness, warmDeltas, docIdOfQuery, writeReportFixture, accept } from "./harness.js";

const PLAN_JSON = JSON.stringify({ intent: "research", tasks: [{ description: "investigate the topic" }], clarifyQuestions: [] });
const B = "2026-01-01T00-00-00-000";

test("library search is refused while a run is live, and served once the brief has settled", async () => {
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, B, "Doc B", "B's settled body."),
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "findings", kind: "report", stallTokens: 200 },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "research:start", send: { type: "library_search", query: "settled" } },
      { on: (ev) => ev.type === "complete" },
      // Idle comes a hop after `complete`: ask until the search is served, paced by the list echo.
      { until: (ev) => ev.type === "library:search", repoke: (ev) => ev.type === "library:list",
        poke: [{ type: "library_search", query: "settled" }, { type: "library_list" }] },
    ],
  });
  const completeAt = run.events.findIndex((e) => e.type === "complete");
  const searches = run.events.map((e, i) => [e, i] as const).filter(([e]) => e.type === "library:search");
  assert.equal(searches.length, 1, "one search served: the one asked after the run");
  assert.ok(searches[0][1] > completeAt, "nothing was served while the run was live");
});

test("an ability's settings are refused while a run is live: a toast, and the run settles untouched", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "findings", kind: "report", stallTokens: 200 },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "research:start", send: { type: "set_ability_config", name: "web", values: { topN: 3 } } },
      { on: (ev) => ev.type === "ui:error" },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const toast = run.events.find((e) => e.type === "ui:error") as { message: string };
  assert.match(toast.message, /Wait for the run to finish/);
  assert.equal(run.events.filter((e) => e.type === "config:updated").length, 0, "nothing was saved");
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 0);
});

test("a change of output directory takes effect for the next brief", async () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "owner-other-"));
  const run = await runHarness({
    utterances: [{ text: "First answer.", kind: "text" }, { text: "Second answer.", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "A?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete", send: { type: "set_config", patch: { sources: { outputDir: other } } } },
      { on: (ev) => ev.type === "config:updated", send: { type: "new_run" } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === null,
        send: { type: "submit_query", query: "B?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const a = docIdOfQuery(run.events, 0);
  const b = docIdOfQuery(run.events, 1);
  assert.ok(fs.existsSync(path.join(run.outputDir, a, "report.md")), "A settled in the directory of its time");
  assert.ok(fs.existsSync(path.join(other, b, "report.md")), "B settled in the new directory");
  assert.equal(fs.existsSync(path.join(run.outputDir, b)), false);
  const lists = run.events.filter((e) => e.type === "library:list") as { entries: { docId: string }[] }[];
  assert.deepEqual(lists[lists.length - 1].entries.map((e) => e.docId), [b], "the shelf is the new directory's");
});

test("open_doc during a run moves the canvas and touches no KV", async () => {
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, B, "Doc B", "B's settled body."),
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "findings", kind: "report", stallTokens: 200 },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "research:start", send: { type: "open_doc", docId: B } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === B },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const types = run.events.map((e) => e.type);
  assert.ok(types.indexOf("doc") > types.indexOf("research:start") && types.indexOf("doc") < types.indexOf("complete"), "B came to the canvas mid-run");
  const deltas = warmDeltas(run.trace);
  assert.equal(deltas.length, 1, "the run's own settle is the only trunk commit");
  assert.ok(!deltas.some((d) => d.content?.includes("B's settled body")), "nothing of B reached the KV");
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 0);
});
