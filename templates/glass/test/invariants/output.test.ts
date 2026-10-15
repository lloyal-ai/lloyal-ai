import test from "node:test";
import assert from "node:assert/strict";
import { flexibleAnswerOutput } from "../../src/harness/outputs.js";
import { decisionSchema } from "../../src/domain/work.js";

test("decision grammar limits source scope to the available names and inputs", () => {
  const schema = decisionSchema("Auto", ["web"], []);
  const proposal = {
    action: "answer",
    reason: "One answer",
    presentation: "prose",
    clarification: "",
    plan: null,
    sourceScope: { abilities: ["web"], inputs: [] },
  };
  assert.ok(schema.safeParse(proposal).success);
  assert.equal(
    schema.safeParse({
      ...proposal,
      sourceScope: { abilities: ["camera"], inputs: [] },
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      ...proposal,
      sourceScope: { abilities: [], inputs: ["invented"] },
    }).success,
    false,
  );
});

test("table shape is rejected at the typed output boundary so recovery can repair it", () => {
  const output = flexibleAnswerOutput();
  const read = (rows: string[][]) =>
    output.read({
      result: JSON.stringify({
        kind: "table",
        result: "A comparison",
        sources: [],
        table: { columns: ["Option", "Total"], rows },
      }),
    } as Parameters<typeof output.read>[0]);
  assert.equal(read([["A", "140", "extra"]]), null);
  assert.ok(read([["A", "140"]]));
});

test("report rejects title-shaped attachment URLs and accepts the public page grammar", () => {
  const output = flexibleAnswerOutput();
  const read = (url: string) =>
    output.read({
      result: JSON.stringify({
        kind: "prose",
        result: "A blue circle.",
        sources: [{ title: "Page 1", url }],
      }),
    } as Parameters<typeof output.read>[0]);
  assert.equal(read("attachment://Two markers — 1 page"), null);
  assert.equal(read("attachment://abcdef/page/0"), null);
  assert.equal(read("javascript:alert(1)"), null);
  assert.ok(read("attachment://99781336/page/1"));
  assert.ok(read("https://example.org/source"));
});

test("report does not accept a malformed document link hidden in result prose", () => {
  const output = flexibleAnswerOutput();
  const result = JSON.stringify({
    kind: "prose",
    result: "[Page](attachment://Two markers/page/1)",
    sources: [],
  });
  assert.equal(
    output.read({ result } as Parameters<typeof output.read>[0]),
    null,
  );
});
