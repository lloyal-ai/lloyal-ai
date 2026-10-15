import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "effection";
import { SpawnRefused } from "@lloyal-labs/lloyal-agents";
import type { Agent, PoolContext } from "@lloyal-labs/lloyal-agents";
import {
  decisionSchema,
  validateDecision,
  type Finding,
  type Plan,
  type PlanState,
} from "../../src/domain/work.js";
import { guardedShape } from "../../src/harness/work.js";
import { runHarness } from "./harness.js";
import type { WorkflowEvent } from "../../src/protocol.js";

const task = (id: string) => ({
  id,
  title: id,
  instruction: `Check ${id}`,
  ability: "",
  dependsOn: [],
});
const plan = (topology: Plan["topology"] = "parallel"): Plan => ({
  objective: "Compare the supplied facts",
  reason: "Check the inputs",
  topology,
  presentation: "prose",
  tasks: [task("first"), task("second")],
  review: false,
  preflight: false,
  revisit: false,
  inputs: [],
});
const proposal = (p: Plan) => ({
  action: "compose",
  reason: p.reason,
  presentation: p.presentation,
  clarification: "",
  sourceScope: null,
  plan: p,
});
const sufficient = {
  action: "answer",
  reason: "The completed answer resolves the request",
  presentation: "prose",
  clarification: "",
  sourceScope: null,
  plan: null,
};
const utter = (value: unknown) => ({
  kind: "text" as const,
  text: JSON.stringify(value),
});
const report = (text: string) => ({ kind: "report" as const, text });
const savedTurn = (events: WorkflowEvent[]) =>
  events.filter((e) => e.type === "conversation").at(-1)?.record.turns[0];

for (const topology of ["fanout", "chain"] as const)
  for (const failure of ["refused", "failed", "capped", "empty"] as const)
    test(`${topology} cannot advance past a prerequisite that is ${failure}, even without declared edges`, async () => {
      const requested: string[] = [],
        findings = new Map<string, Finding>();
      const ctx = {
        spine: { position: 0 },
        canFit: () => true,
        *spawn(spec) {
          requested.push(spec.key!);
          if (failure === "refused")
            throw new SpawnRefused("pressure_init", {
              key: spec.key,
              agentId: null,
              result: null,
              failed: "pressure_init",
            });
          return {
            id: 1,
            forkHead: 0,
            result: failure === "empty" ? null : "Plausible text",
            failed: failure === "failed" ? "failure" : null,
            exitReason: failure === "capped" ? "terminal_cap" : undefined,
          } as Agent;
        },
        *waitFor(agent) {
          return agent;
        },
        *extendSpine() {
          assert.fail("Rejected findings must never enter the spine");
        },
      } as PoolContext;
      await assert.rejects(
        run(() =>
          guardedShape(
            plan(topology),
            (t) => ({ key: t.id, content: t.instruction, systemPrompt: "" }),
            findings,
            function* () {},
          )(ctx),
        ),
        /accepted finding/,
      );
      assert.deepEqual(requested, ["first"]);
      assert.equal(findings.size, 0);
    });

test("an independent parallel sibling still completes after another spawn is refused", async () => {
  const findings = new Map<string, Finding>();
  const ctx = {
    spine: { position: 0 },
    canFit: () => true,
    *spawn(spec) {
      if (spec.key === "first")
        throw new SpawnRefused("pressure_init", {
          key: spec.key,
          agentId: null,
          result: null,
          failed: "pressure_init",
        });
      return {
        id: 2,
        forkHead: 0,
        result: "Independent finding",
        failed: null,
      } as Agent;
    },
    *waitFor(agent) {
      return agent;
    },
    *extendSpine() {
      return 1;
    },
  } as PoolContext;
  await run(() =>
    guardedShape(
      plan(),
      (t) => ({ key: t.id, content: t.instruction, systemPrompt: "" }),
      findings,
      function* () {},
    )(ctx),
  );
  assert.deepEqual([...findings.keys()], ["second"]);
});

test("conflicting composed presentation is rejected at validation", () => {
  assert.throws(
    () =>
      validateDecision(
        { ...proposal(plan()), presentation: "table" },
        "Auto",
        [],
        [],
      ),
    /presentation/i,
  );
  assert.equal(
    validateDecision(proposal(plan()), "Auto", [], []).plan?.presentation,
    "prose",
  );
});

test("plan evidence references do not silently become a source restriction", () => {
  const p = { ...plan(), inputs: ["a"] };
  const d = validateDecision(
    proposal(p),
    "Auto",
    ["web", "documents"],
    ["a", "b"],
  );
  assert.deepEqual(d.plan?.inputs, ["a"]);
  assert.equal(d.sourceScope, null);
  assert.throws(
    () =>
      validateDecision(
        {
          ...proposal(p),
          sourceScope: { abilities: [], inputs: [] },
        },
        "Auto",
        ["web", "documents"],
        ["a", "b"],
      ),
    /unavailable evidence/,
  );
});

for (const mode of ["Plan", "Parallel", "Chain", "Graph"] as const) {
  test(`${mode} may finish at revisit without relaxing its initial mode constraint`, () => {
    assert.equal(
      decisionSchema(mode, [], []).safeParse(sufficient).success,
      false,
    );
    assert.equal(
      decisionSchema(mode, [], [], "revisit").safeParse(sufficient).success,
      true,
    );
    assert.throws(() => validateDecision(sufficient, mode, [], []), /ignore/);
    assert.equal(
      validateDecision(sufficient, mode, [], [], "revisit").action,
      "answer",
    );
    if (mode !== "Plan") {
      const wrong = proposal(plan(mode === "Parallel" ? "chain" : "parallel"));
      assert.equal(
        decisionSchema(mode, [], [], "revisit").safeParse(wrong).success,
        false,
      );
      assert.throws(
        () => validateDecision(wrong, mode, [], [], "revisit"),
        /honour/,
      );
    }
  });

  test(`${mode} commits a sufficient synthesized answer without another work stage`, async () => {
    const topology = (
      {
        Parallel: "parallel",
        Chain: "chain",
        Graph: "graph",
        Plan: "parallel",
      } as const
    )[mode];
    const p = {
      ...plan(topology),
      tasks: [task("first")],
      revisit: true,
      review: mode === "Plan" || mode === "Graph",
    };
    let turn = "",
      state: PlanState;
    const r = await runHarness({
      utterances: [
        utter(proposal(p)),
        report("Accepted finding"),
        report("Useful combined answer"),
        utter(sufficient),
      ],
      observe: (e) => {
        if (e.type === "work:start") turn = e.turnId;
        if (e.type === "work:plan") state = e.state;
      },
      script: [
        { send: { type: "submit_query", query: p.objective, mode } },
        ...(p.review
          ? [
              {
                on: (e: WorkflowEvent) =>
                  e.type === "work:plan" && e.state.awaitingApproval,
                send: () => ({
                  type: "approve_plan" as const,
                  turnId: turn,
                  revision: state.revision,
                }),
              },
            ]
          : []),
        { on: (e) => e.type === "work:ended" },
      ],
    });
    assert.equal(savedTurn(r.events)?.answer, "Useful combined answer");
    assert.equal(savedTurn(r.events)?.status, "complete");
    assert.equal(r.events.filter((e) => e.type === "agent:spawn").length, 4);
    assert.ok(
      r.events
        .filter((e) => e.type === "work:plan")
        .every((e) => e.state.revision === 1),
    );
  });
}

test("a revisit clarification preserves the completed typed answer and its evidence", async () => {
  const p = {
    ...plan(),
    presentation: "table" as const,
    tasks: [task("first")],
    revisit: true,
  };
  const table = { columns: ["Option", "Total"], rows: [["A", "140"]] };
  const sources = [
    { title: "Supplied facts", url: "https://example.org/facts" },
  ];
  const r = await runHarness({
    oneshot: p.objective,
    utterances: [
      utter(proposal(p)),
      report("A totals 140"),
      {
        kind: "tool",
        text: "",
        tool: {
          name: "report",
          args: {
            result: "A totals 140.",
            sources,
            table,
          },
        },
      },
      utter({
        ...sufficient,
        action: "clarify",
        clarification: "Which delivery region should I check next?",
      }),
    ],
  });
  assert.equal(r.failure, undefined);
  const saved = savedTurn(r.events);
  assert.match(saved?.answer ?? "", /A totals 140/);
  assert.match(saved?.answer ?? "", /Which delivery region/);
  assert.equal(saved?.payload?.kind, "table");
  assert.deepEqual(saved?.payload?.table?.columns, table.columns);
  assert.deepEqual(saved?.payload?.sources, sources);
});

test("Parallel decision grammar excludes dependent tasks before sampling", () => {
  const p = plan();
  p.tasks[1].dependsOn = ["first"];
  assert.equal(
    decisionSchema("Parallel", [], []).safeParse(proposal(p)).success,
    false,
  );
  p.tasks[1].dependsOn = [];
  assert.equal(
    decisionSchema("Parallel", [], []).safeParse(proposal(p)).success,
    true,
  );
});
