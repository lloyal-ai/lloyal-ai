/**
 * An article outlives the process, and the ORDER of the two writes is what decides when it counts.
 *
 * `article.md` is written first — a projection a human or a corpus can read — and the record last, so the
 * record's existence IS the commit. A crash between them leaves markdown nobody listed, which is correct: a
 * half-written turn is not an article. That is the one behaviour worth a test here, because it is the one a
 * developer reading the template is meant to learn.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { runHarness, warmDeltas } from "./harness.js";
import type { WorkflowEvent } from "../../src/protocol.js";

const ARTICLE = "## Thesis\n\nSolid-state cells are near, not here.";

const TURN = [
  { kind: "report" as const, text: "Angle one." },
  { kind: "report" as const, text: "Angle two." },
];

const SCRIPT = [...TURN, { kind: "text" as const, text: ARTICLE }];

/** The model grouping a shelf of two under one topic: the naming agent, then one filing agent per article. */
const GROUPING = [
  { kind: "tool" as const, tool: { name: "topics", args: { topics: ["Batteries"] } } },
  { kind: "text" as const, text: "1" },
  { kind: "text" as const, text: "1" },
];

/** Every `library` event on the wire, in order — the shelf as each surface saw it. */
const shelves = (events: readonly WorkflowEvent[]) =>
  events.filter((e): e is Extract<WorkflowEvent, { type: "library" }> => e.type === "library");

/** Plant a folder the way a turn would have left it, or half of one. */
function plant(root: string, name: string, record: unknown | null): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "article.md"), "# planted\n\nbody\n", "utf8");
  if (record !== null) {
    fs.writeFileSync(path.join(dir, "article.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
}

const recordOf = (query: string) => ({ version: 1, query, savedAt: "2026-09-01T00:00:00.000Z", answer: "kept" });

test("a settled turn is written to disk and listed back", async () => {
  const run = await runHarness({
    utterances: SCRIPT,
    script: [
      { send: { type: "submit_query", query: "are solid-state batteries ready?" } },
      // Wait for the SHELF, not the answer: keeping the article is the last thing the turn does, and a script
      // that stops at `answer` quits while that is still in flight.
      { on: (ev) => ev.type === "library" && ev.articles.length === 1 },
    ],
  });

  const last = shelves(run.events).at(-1);
  assert.ok(last, "the shelf was never said");
  assert.equal(last.articles.length, 1, "the settled turn should be on the shelf");
  assert.equal(last.articles[0].query, "are solid-state batteries ready?");

  // …and it is genuinely on disk, not merely announced.
  const folder = path.join(run.outputDir, last.articles[0].docId);
  const record = JSON.parse(fs.readFileSync(path.join(folder, "article.json"), "utf8")) as Record<string, unknown>;
  assert.equal(record.answer, ARTICLE, "the record must keep what the model actually produced");
  assert.deepEqual(
    Object.keys(record).sort(),
    ["answer", "query", "savedAt", "version"],
    "four fields — a `topic` here would mean classification moved back to save time, which bakes in drift",
  );
  assert.match(fs.readFileSync(path.join(folder, "article.md"), "utf8"), /Solid-state cells/);
});

test("the record's existence is the commit — markdown alone is not an article", async () => {
  const run = await runHarness({
    setup: (outputDir) => {
      plant(outputDir, "2026-09-01-complete", recordOf("a finished turn"));
      plant(outputDir, "2026-09-02-crashed", null);   // died between the two writes
    },
    script: [{ on: (ev) => ev.type === "library" }],
  });

  const shelf = shelves(run.events)[0];
  assert.deepEqual(
    shelf.articles.map((a) => a.query),
    ["a finished turn"],
    "a folder holding markdown but no record must not be listed — the turn never committed",
  );
});

test("the shelf paints before the model groups it", async () => {
  // The non-blocking property IS the feature: a landing that waited on a model call would make the app feel
  // slower, not cleverer. So the first shelf on the wire must already carry the articles, with no grouping.
  const run = await runHarness({
    setup: (outputDir) => {
      plant(outputDir, "2026-09-01-a", recordOf("solid state batteries"));
      plant(outputDir, "2026-09-02-b", recordOf("lithium mining"));
    },
    utterances: GROUPING,
    script: [{ until: (ev) => ev.type === "library" && ev.groups !== null, repoke: () => false, poke: [] }],
  });

  const said = shelves(run.events);
  assert.equal(said[0].articles.length, 2, "the shelf must be said with its articles before any grouping");
  assert.equal(said[0].groups, null, "the first paint must not wait for the model");

  const grouped = said.find((s) => s.groups !== null);
  assert.ok(grouped, "the grouping never arrived");
  assert.deepEqual(grouped.groups?.map((g) => g.topic), ["Batteries"]);
});

test("a topic only one article is filed under is not a pile: that article stays on the flat list", async () => {
  const run = await runHarness({
    setup: (outputDir) => {
      plant(outputDir, "2026-09-01-a", recordOf("solid state batteries"));
      plant(outputDir, "2026-09-02-b", recordOf("lithium mining"));
      plant(outputDir, "2026-09-03-c", recordOf("the Antikythera mechanism"));
    },
    utterances: [
      { kind: "tool", tool: { name: "topics", args: { topics: ["Batteries", "Ancient technology"] } } },
      { kind: "text", text: "1" },
      { kind: "text", text: "1" },
      { kind: "text", text: "2" },
    ],
    script: [{ until: (ev) => ev.type === "library" && ev.groups !== null, repoke: () => false, poke: [] }],
  });

  const grouped = shelves(run.events).find((s) => s.groups !== null);
  assert.deepEqual(grouped?.groups, [{ topic: "Batteries", docIds: ["2026-09-01-a", "2026-09-02-b"] }]);
  assert.equal(grouped?.articles.length, 3, "the lone article is still on the shelf, ungrouped");
});

// ── a kept article opens back onto the page ──

test("a kept article opens onto the page, and a question asked there deepens it from its record", async () => {
  const KEPT = "## A kept page about the mechanism";
  const run = await runHarness({
    setup: (outputDir) => plant(outputDir, "2026-09-01-a", { ...recordOf("the Antikythera mechanism"), answer: KEPT }),
    utterances: [...TURN, { kind: "text", text: "## The page, deepened" }],
    script: [
      { send: { type: "open_doc", docId: "2026-09-01-a" } },
      { on: (ev) => ev.type === "doc:active" && ev.docId === "2026-09-01-a" },
      { send: { type: "submit_query", query: "where is it displayed today?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
    ],
  });

  const doc = run.events.find((e) => e.type === "doc");
  assert.deepEqual(doc, { type: "doc", docId: "2026-09-01-a", title: "the Antikythera mechanism", answer: KEPT });
  const query = run.events.find((e): e is Extract<WorkflowEvent, { type: "query" }> => e.type === "query");
  assert.equal(query?.warm, true, "a question asked on an opened article deepens it");
  assert.ok(
    warmDeltas(run.trace).some((t) => (t.content ?? "").includes(KEPT)),
    "the model's memory of the page is rebuilt from the opened article's own record",
  );
});

test("an article that is no longer there says so, and the page stays as it was", async () => {
  const run = await runHarness({
    script: [
      { send: { type: "open_doc", docId: "2026-01-01-gone" } },
      { on: (ev) => ev.type === "ui:error" },
    ],
  });

  assert.deepEqual(run.events.filter((e) => e.type === "doc" || e.type === "doc:active"), []);
  const toast = run.events.find((e): e is Extract<WorkflowEvent, { type: "ui:error" }> => e.type === "ui:error");
  assert.match(toast?.message ?? "", /no longer there/);
});

test("the landing is where the shelf is regrouped, and a question asked there starts a new article", async () => {
  const run = await runHarness({
    setup: (outputDir) => {
      plant(outputDir, "2026-09-01-a", recordOf("solid state batteries"));
      plant(outputDir, "2026-09-02-b", recordOf("lithium mining"));
    },
    utterances: [...GROUPING, ...GROUPING, ...TURN, { kind: "text", text: "## A new page" }],
    script: [
      { on: (ev) => ev.type === "library" && ev.groups !== null },
      { send: { type: "open_doc", docId: "2026-09-01-a" } },
      { on: (ev) => ev.type === "doc:active" && ev.docId !== null },
      { send: { type: "open_doc", docId: null } },
      { on: (ev) => ev.type === "doc:active" && ev.docId === null },
      { on: (ev) => ev.type === "library" && ev.groups !== null },
      { send: { type: "submit_query", query: "what is sodium-ion?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 3 },
    ],
  });

  const home = run.events.findIndex((e) => e.type === "doc:active" && e.docId === null);
  const regrouped = run.events.findIndex((e, i) => i > home && e.type === "library" && e.groups !== null);
  assert.ok(home >= 0 && regrouped > home, "arriving on the landing regroups the shelf it is about to show");
  const query = run.events.find((e): e is Extract<WorkflowEvent, { type: "query" }> => e.type === "query");
  assert.equal(query?.warm, false, "a question asked from the landing starts a new article");
});

test("while a turn is writing the page, navigating away is ignored", async () => {
  const run = await runHarness({
    setup: (outputDir) => plant(outputDir, "2026-09-01-a", recordOf("the Antikythera mechanism")),
    utterances: [...TURN, { kind: "text", text: "## Written" }],
    script: [
      { send: { type: "submit_query", query: "what is a solid-state cell?" } },
      { send: { type: "open_doc", docId: "2026-09-01-a" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
    ],
  });

  assert.deepEqual(run.events.filter((e) => e.type === "doc" || e.type === "doc:active"), []);
  const answer = run.events.find((e): e is Extract<WorkflowEvent, { type: "answer" }> => e.type === "answer");
  assert.equal(answer?.text, "## Written", "the turn finishes the page it was writing");
});

test("a one-shot run is over when its answer is kept: grouping waits for a landing it will never show", async () => {
  // The process waits for the whole run before it exits, so anything started after the answer is time the
  // caller pays for a shelf nobody sees.
  const run = await runHarness({
    oneshot: "are solid-state batteries ready?",
    setup: (outputDir) => {
      plant(outputDir, "2026-09-01-a", recordOf("solid state batteries"));
      plant(outputDir, "2026-09-02-b", recordOf("lithium mining"));
    },
    utterances: [...TURN, { kind: "text", text: "## Settled without a reader" }],
  });

  const answered = run.events.findIndex((e) => e.type === "answer");
  assert.ok(answered >= 0, "the run never answered");
  assert.deepEqual(
    run.events.slice(answered).filter((e) => e.type === "agent:spawn"),
    [],
    "no agent may start once the article is kept",
  );
});
