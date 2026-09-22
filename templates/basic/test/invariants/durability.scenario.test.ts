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
import { runHarness } from "./harness.js";
import type { WorkflowEvent } from "../../src/protocol.js";

const ARTICLE = "## Thesis\n\nSolid-state cells are near, not here.";

const SCRIPT = [
  { kind: "report" as const, text: "Angle one." },
  { kind: "report" as const, text: "Angle two." },
  { kind: "text" as const, text: ARTICLE },
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
  const folder = path.join(run.outputDir, last.articles[0].id);
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
    utterances: [
      { kind: "tool", tool: { name: "topics", args: { topics: ["Batteries"] } } },
      { kind: "text", text: "1" },
      { kind: "text", text: "1" },
    ],
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
  assert.deepEqual(grouped?.groups, [{ topic: "Batteries", ids: ["2026-09-01-a", "2026-09-02-b"] }]);
  assert.equal(grouped?.articles.length, 3, "the lone article is still on the shelf, ungrouped");
});
