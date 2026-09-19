/**
 * A brief that ran to its end and found nothing. The writer's word for it is one — `answer: null`, whichever
 * path produced nothing — and everything downstream keeps to it: nothing joins the trunk, nothing is written,
 * a cold brief's folder is released and a settled one is left as it was, and the reader is told where the
 * answer would have been.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { runHarness, warmDeltas, writeReportFixture, docIdOfQuery, dirs } from "./harness.js";
import { reduce, initialState } from "../../src/ui/state.js";
import { selectAnswer, selectExchanges } from "../../src/ui/select.js";

const SAVED = "2026-01-01T00-00-00-000";

test("a cold direct ask whose agent says nothing: the answer is null, nothing is committed, and the folder goes", async () => {
  const run = await runHarness({
    utterances: [{ text: "", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const answer = run.events.find((e) => e.type === "answer") as { text: string | null };
  assert.equal(answer.text, null, "an answer with no text is no answer");
  assert.equal(warmDeltas(run.trace).length, 0, "nothing joined the trunk");
  assert.deepEqual(dirs(run.outputDir), [], "a brief that settled nothing keeps no folder");
  const s = run.events.reduce(reduce, initialState);
  const doc = s.documents.get(docIdOfQuery(run.events))!;
  assert.equal(doc.phase, "done");
  assert.equal(selectAnswer(s), null, "the view has nothing to show, and says so where the answer would be");
});

test("a follow-up into a settled brief that finds nothing: the exchange has no body, and the brief on disk is untouched", async () => {
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, SAVED, "Saved brief", "The saved body."),
    utterances: [{ text: "", kind: "text" }],
    script: [
      { send: { type: "open_doc", docId: SAVED } },
      { on: (ev) => ev.type === "doc:active", send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const answer = run.events.find((e) => e.type === "answer") as { text: string | null };
  assert.equal(answer.text, null);
  assert.deepEqual(fs.readdirSync(path.join(run.outputDir, SAVED)).sort(), ["report.json", "report.md"], "no exchange was written");
  const s = run.events.reduce(reduce, initialState);
  assert.deepEqual(selectExchanges(s), [{ question: "And then?", body: null, attachments: [] }], "the reader's question stands, with nothing beneath it");
  assert.equal(s.documents.get(SAVED)!.ask, null, "the ask is over");
});
