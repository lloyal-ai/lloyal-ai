import test from "node:test";
import assert from "node:assert/strict";
import { weaveSourcesIntoResult } from "@lloyal-labs/rig";
import { finishAnswer } from "../../src/harness/outputs.js";
import {
  withoutSourceTrailer,
  uniqueSources,
} from "../../src/domain/citations.js";
import { answerText } from "../../src/domain/answer.js";
import { withoutRepeatedTable } from "../../src/domain/table-prose.js";
const sources = [
  { title: "Manual [v2]", url: "https://example.org/manual#cost" },
  { title: "PDF page 2", url: "attachment://abcdef12/page/2" },
];
test("an exact repeated table is removed before acceptance; different evidence survives", () => {
  const table = {
    columns: ["Venue", "Year"],
    rows: [["Example", "[1889](https://example.org/a)"]],
  };
  const duplicate =
    "| Venue | Year |\n| --- | --- |\n| Example | [1889](https://example.org/a) |";
  const result = "Introduction.\n\n" + duplicate + "\n\nConclusion.";
  const answer = finishAnswer("table", { result, table, sources: [] });
  assert.equal(
    answer.result.replace(/\n+/g, "\n"),
    "Introduction.\nConclusion.",
  );
  assert.equal((answerText(answer).match(/\| Venue \|/g) ?? []).length, 1);
  const otherEvidence = result.replace(
    "https://example.org/a",
    "https://example.org/b",
  );
  assert.equal(withoutRepeatedTable(otherEvidence, table), otherEvidence);
  assert.equal(withoutRepeatedTable("Just prose", table), "Just prose");
});
test("typed cells retain public inline weaving without duplicating the bibliography", () => {
  const answer = finishAnswer("table", {
    result: "Comparison",
    sources,
    table: {
      columns: ["Feature", "Value"],
      rows: [
        ["Cost", `140 per ${sources[0].url}`],
        ["Diagram", `[page](${sources[1].url})`],
      ],
    },
  });
  assert.equal(answer.table!.rows[0][0], "Cost");
  assert.match(
    answer.table!.rows[0][1],
    /\[Manual \\\[v2\\\]\]\(https:\/\/example.org\/manual#cost\)/,
  );
  assert.equal(answer.table!.rows[1][1], `[page](${sources[1].url})`);
  assert.equal((answerText(answer).match(/Sources:/g) ?? []).length, 1);
});
test("legacy display removes only a complete framework bibliography and preserves exact targets", () => {
  const body = `[cost](${sources[0].url}) and [diagram](${sources[1].url})`;
  assert.equal(
    withoutSourceTrailer(weaveSourcesIntoResult(body, sources), sources),
    body,
  );
  const custom =
    body + "\n\nSources:\n- [Different evidence](https://other.example.org)";
  assert.equal(withoutSourceTrailer(custom, sources), custom);
  assert.equal(withoutSourceTrailer(body, sources), body);
});
test("source grouping preserves distinct bookmarks and the first declared title", () => {
  assert.deepEqual(
    uniqueSources([
      sources[0],
      { ...sources[0], title: "Duplicate" },
      { ...sources[0], url: "https://example.org/manual#terms" },
    ]),
    [sources[0], { ...sources[0], url: "https://example.org/manual#terms" }],
  );
});
test("checklist text and detail do not each grow a bibliography", () => {
  const a = finishAnswer("checklist", {
    result: "Prepare",
    sources,
    checklist: [{ text: "Check costs", detail: sources[0].url }],
  });
  assert.equal(a.checklist![0].text, "Check costs");
  assert.equal((answerText(a).match(/Sources:/g) ?? []).length, 1);
});
