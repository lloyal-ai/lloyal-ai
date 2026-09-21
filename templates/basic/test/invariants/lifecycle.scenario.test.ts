/**
 * What the model REMEMBERS, and when that can be trusted.
 *
 * Three facts have to agree after every turn: what is saved, what the reader was shown, and what the next
 * question continues from. They come apart at the edges — a turn that was stopped, one whose memory update
 * failed, a grouping running when a question arrives — and each of those is a path here.
 *
 * The rule the app holds: a record on disk is what a page IS, and the model's memory of it is a cache that any
 * interrupted turn invalidates. So memory is never restored, only rebuilt, and always from the page's own
 * record rather than from whichever folder is newest.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { runHarness, warmDeltas } from "./harness.js";
import type { WorkflowEvent } from "../../src/protocol.js";

const queries = (events: readonly WorkflowEvent[]) =>
  events.filter((e): e is Extract<WorkflowEvent, { type: "query" }> => e.type === "query");
const answers = (events: readonly WorkflowEvent[]) =>
  events.filter((e): e is Extract<WorkflowEvent, { type: "answer" }> => e.type === "answer").map((e) => e.text);
const shelves = (events: readonly WorkflowEvent[]) =>
  events.filter((e): e is Extract<WorkflowEvent, { type: "library" }> => e.type === "library");

const recordOf = (query: string) => ({ version: 1, query, savedAt: "2026-09-01T00:00:00.000Z", answer: "kept" });

function plant(root: string, name: string, record: unknown): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "article.md"), "# planted\n\nbody\n", "utf8");
  fs.writeFileSync(path.join(dir, "article.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

test("a question takes the model from the grouping rather than sharing it", async () => {
  // The grouping is model work like any other, so it goes through the one execution owner. If it ran beside a
  // turn instead, both would be talking to the same context: the scripted model hands out utterances in the
  // order they are asked for, so a classifier sampling mid-turn steals the angle's and the article comes back
  // wrong. There is no `topics` utterance here on purpose — the grouping must never get that far.
  const run = await runHarness({
    setup: (outputDir) => {
      plant(outputDir, "2026-09-01-a", recordOf("solid state batteries"));
      plant(outputDir, "2026-09-02-b", recordOf("lithium mining"));
    },
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
    ],
    script: [
      { send: { type: "submit_query", query: "what is a solid-state cell?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 3 },
    ],
  });

  assert.deepEqual(answers(run.events), ["## The article"], "the angles' utterances must not have been taken");
  const grouped = shelves(run.events).filter((s) => s.groups !== null);
  assert.equal(grouped.length, 0, "a grouping that reached the model would have consumed an angle's turn");
});

test("a stopped turn leaves the page, and the next question is still a follow-up", async () => {
  // The bug this pins: `warm` used to be read off the live trunk at the moment the question arrived. A stop
  // returns before its cleanup finishes, so that read caught the trunk mid-teardown, saw null, and opened a
  // cold page — throwing away an article that was still on screen.
  const run = await runHarness({
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
      { kind: "report", text: "Angle one, again." },
      { kind: "report", text: "Angle two, again." },
      { kind: "text", text: "## The article, extended" },
    ],
    script: [
      { send: { type: "submit_query", query: "what is the Antikythera mechanism?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 1 },
      { send: { type: "submit_query", query: "who built it?" } },
      { send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted" },
      { send: { type: "submit_query", query: "when was it found?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
    ],
  });

  const asked = queries(run.events);
  assert.equal(asked.length, 3);
  assert.equal(asked[0].warm, false, "the first question has no page to extend");
  assert.equal(asked[2].warm, true, "a stopped turn does not take the page with it");
});

test("after a stop, memory is rebuilt from the record rather than trusted", async () => {
  // A stopped turn may have committed a pair nobody was shown. The next question therefore cannot continue
  // from whatever the trunk happens to hold: it releases it and rebuilds from the page's own record, which is
  // the only thing that was ever shown to a reader.
  const run = await runHarness({
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
      { kind: "report", text: "Angle one, again." },
      { kind: "report", text: "Angle two, again." },
      { kind: "text", text: "## The article, extended" },
    ],
    script: [
      { send: { type: "submit_query", query: "what is the Antikythera mechanism?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 1 },
      { send: { type: "submit_query", query: "who built it?" } },
      { send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted" },
      { send: { type: "submit_query", query: "when was it found?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
    ],
  });

  // Two settled turns commit; the interrupted one must not leave a commit the reader never saw standing as
  // the page. A rebuild is itself a commit, so the third turn's own is on top of one it made from the record.
  assert.ok(
    warmDeltas(run.trace).length >= 3,
    "the third question must rebuild the page from its record before extending it",
  );
  assert.deepEqual(
    answers(run.events).filter((a) => a !== null),
    ["## The article", "## The article, extended"],
    "the stopped turn contributes no answer, and the one after it extends the page that was shown",
  );
});

test("the page a session extends is the record it saved, not the newest folder", async () => {
  // Someone else's article, planted with a LATER name than the one this session writes, so "newest folder"
  // and "this session's page" disagree. Memory has to be rebuilt from the latter.
  const run = await runHarness({
    setup: (outputDir) => plant(outputDir, "2099-01-01-elsewhere", recordOf("an article from another session")),
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
      { kind: "report", text: "Angle one, again." },
      { kind: "report", text: "Angle two, again." },
      { kind: "text", text: "## The article, extended" },
    ],
    script: [
      { send: { type: "submit_query", query: "what is the Antikythera mechanism?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
      { send: { type: "stop" } },   // invalidates memory, forcing the next question to rebuild
      { send: { type: "submit_query", query: "who built it?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 3 },
    ],
  });

  assert.deepEqual(
    answers(run.events).filter((a) => a !== null),
    ["## The article", "## The article, extended"],
    "rebuilding from the wrong record would extend a stranger's article",
  );
});
