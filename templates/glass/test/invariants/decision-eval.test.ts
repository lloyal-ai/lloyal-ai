import assert from "node:assert/strict";
import { test } from "node:test";
import { Decision } from "../../src/domain/work.js";
import { cases } from "../eval/decisions/cases.js";
import { score, compare, type Result } from "../eval/decisions/score.js";
const answer = Decision.parse({
  action: "answer",
  reason: "Sufficient",
  presentation: "prose",
  clarification: "",
  plan: null,
  sourceScope: null,
});
test("eval cannot mistake inherited unrestricted sources for an empty restriction", () => {
  const fixture = cases.find((c) => c.id === "supplied-facts")!;
  assert.equal(score(fixture, answer).length, 1);
  assert.deepEqual(
    score(fixture, { ...answer, sourceScope: { abilities: [], inputs: [] } }),
    [],
  );
});
test("eval permits equivalent shapes but rejects missing handoffs", () => {
  const fixture = cases.find((c) => c.id === "landscape-fanout")!;
  const d = Decision.parse({
    ...answer,
    action: "compose",
    plan: {
      objective: "Investigate",
      reason: "Survey first",
      topology: "graph",
      presentation: "prose",
      review: true,
      preflight: false,
      revisit: false,
      inputs: [],
      tasks: [
        {
          id: "survey",
          title: "Survey",
          instruction: "Survey",
          ability: "web",
          dependsOn: [],
        },
        {
          id: "a",
          title: "Check A",
          instruction: "Check A",
          ability: "web",
          dependsOn: ["survey"],
        },
        {
          id: "b",
          title: "Check B",
          instruction: "Check B",
          ability: "web",
          dependsOn: ["survey"],
        },
      ],
    },
  });
  assert.deepEqual(score(fixture, d), []);
  if (d.action !== "compose") throw new Error("fixture");
  d.plan.topology = "fanout";
  assert.deepEqual(score(fixture, d), []);
  d.plan.tasks.forEach((t) => (t.dependsOn = []));
  assert.match(score(fixture, d).join(), /handoffs/);
});
test("eval requires a real retained attachment and restricts tool availability", () => {
  const fixture = cases.find((c) => c.id === "document-only")!;
  const d = {
    ...answer,
    presentation: "table" as const,
    sourceScope: { abilities: ["documents"], inputs: ["sha256:fixture"] },
  };
  assert.deepEqual(score(fixture, d, ["sha256:fixture"]), []);
  assert.match(score(fixture, d, []).join(), /attachment/);
  assert.match(
    score(fixture, { ...d, sourceScope: null }, ["sha256:fixture"]).join(),
    /disallowed/,
  );
  assert.match(
    score(
      fixture,
      { ...d, sourceScope: { abilities: ["documents"], inputs: [] } },
      ["sha256:fixture"],
    ).join(),
    /attachment/,
  );
});
test("eval comparison rejects missing/duplicate pairs and distinguishes regressions", () => {
  const row: Result = {
    caseId: "a",
    seed: 7,
    ms: 100,
    firstTokenMs: 10,
    tokens: 20,
    failures: [],
  };
  assert.equal(
    compare([row], [{ ...row, failures: ["bad"] }])[0].change,
    "regressed",
  );
  assert.equal(
    compare([{ ...row, failures: ["bad"] }], [row])[0].change,
    "recovered",
  );
  assert.throws(() => compare([row], []));
  assert.throws(() => compare([row, row], [row, row]));
  assert.throws(() => compare([row], [{ ...row, seed: 42 }]));
});
