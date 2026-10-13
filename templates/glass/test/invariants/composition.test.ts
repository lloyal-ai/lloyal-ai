import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "effection";
import { runHarness } from "./harness.js";
import {
  validateDecision,
  decisionSchema,
  validatePlan,
  retainedFindings,
  acceptedOutcome,
  type Plan,
  type PlanState,
  type Finding,
} from "../../src/domain/work.js";
import { guardedShape, WorkControl } from "../../src/harness/work.js";
import type { Agent, PoolContext } from "@lloyal-labs/lloyal-agents";
import type { WorkflowEvent, Conversation } from "../../src/protocol.js";
const task = (id: string, dependsOn: string[] = []) => ({
  id,
  title: id,
  instruction: "Check " + id,
  ability: "",
  dependsOn,
});
const plan = (topology: Plan["topology"] = "parallel"): Plan => ({
  objective: "Compare two options",
  reason: "Independent checks are useful.",
  topology,
  presentation: "prose",
  tasks: [task("first"), task("second", topology === "graph" ? ["first"] : [])],
  review: false,
  preflight: false,
  revisit: false,
  inputs: [],
});
const decision = (p: Plan) => ({
  action: "compose",
  reason: p.reason,
  presentation: p.presentation,
  clarification: "",
  plan: p,
});
const utter = (p: Plan) => ({
  kind: "text" as const,
  text: JSON.stringify(decision(p)),
});
const report = (text: string) => ({ kind: "report" as const, text });
const ended = (e: WorkflowEvent) => e.type === "work:ended";
const records = (events: WorkflowEvent[]) =>
  events
    .filter(
      (e): e is Extract<WorkflowEvent, { type: "conversation" }> =>
        e.type === "conversation",
    )
    .map((e) => e.record);

test("Auto answers a simple question without work planning or a source probe", async () => {
  const r = await runHarness({
    oneshot: "Why is the sky blue?",
    utterances: [
      {
        kind: "text",
        text: JSON.stringify({
          action: "answer",
          reason: "An explanation needs one agent.",
          presentation: "prose",
          clarification: "",
          plan: null,
        }),
      },
      report("Air scatters blue light."),
    ],
  });
  assert.equal(r.failure, undefined);
  assert.equal(
    records(r.events).at(-1)?.turns[0].answer,
    "Air scatters blue light.",
  );
  assert.equal(
    r.events.some((e) => e.type === "work:plan" || e.type === "work:coverage"),
    false,
  );
});
for (const topology of ["parallel", "chain", "graph", "fanout"] as const)
  test(`public ${topology} completes with an explicit accepted findings handoff`, async () => {
    const p = { ...plan(topology), review: topology === "graph" };
    let ps: PlanState;
    const script =
      topology === "graph"
        ? [
            {
              send: {
                type: "submit_query" as const,
                mode: "Graph" as const,
                query: "Compare two options",
              },
            },
            {
              on: (e: WorkflowEvent) =>
                e.type === "work:plan" && e.state.awaitingApproval,
              send: () => ({
                type: "approve_plan" as const,
                turnId: turn,
                revision: ps.revision,
              }),
            },
            { on: ended },
          ]
        : undefined;
    let turn = "";
    const r = await runHarness({
      oneshot: script ? undefined : "Compare two options",
      script,
      utterances: [
        utter(p),
        report("First accepted finding."),
        report("Second accepted finding."),
        report("Combined answer."),
      ],
      observe: (e) => {
        if (e.type === "work:plan") ps = e.state;
        if (e.type === "work:start") turn = e.turnId;
      },
    });
    assert.equal(r.failure, undefined);
    assert.equal(records(r.events).at(-1)?.turns[0].answer, "Combined answer.");
    assert.equal(
      r.events.filter((e) => e.type === "work:outcome" && e.accepted).length,
      2,
    );
    assert.ok(
      r.trace.some((e) =>
        JSON.stringify(e).includes("First accepted finding."),
      ),
    );
  });
test("Plan parks with no workers, rejects a stale approval, and accepts the current revision once", async () => {
  const p = { ...plan(), review: true };
  let ps: PlanState,
    turn = "";
  const r = await runHarness({
    utterances: [utter(p), report("A"), report("B"), report("Together")],
    observe: (e) => {
      if (e.type === "work:plan") ps = e.state;
      if (e.type === "work:start") turn = e.turnId;
    },
    script: [
      { send: { type: "submit_query", query: "Make a plan", mode: "Plan" } },
      {
        on: (e) => e.type === "work:plan",
        send: () => ({ type: "approve_plan", turnId: turn, revision: 999 }),
      },
      {
        on: (e) => e.type === "ui:error",
        send: () => ({
          type: "approve_plan",
          turnId: turn,
          revision: ps.revision,
        }),
      },
      { on: ended },
    ],
  });
  const parked = r.events.findIndex((e) => e.type === "work:plan");
  assert.equal(
    r.events.slice(0, parked).filter((e) => e.type === "agent:spawn").length,
    1,
  );
  assert.equal(records(r.events).at(-1)?.turns[0].answer, "Together");
  const c = new WorkControl("Plan");
  c.plan = p;
  c.revision = 1;
  c.awaitingApproval = true;
  c.approve(1);
  assert.throws(() => c.approve(1), /already/);
});
test("editing a parked plan validates the new dependencies and waits for a fresh Start", async () => {
  const p = { ...plan(), review: true };
  let ps: PlanState,
    turn = "";
  const r = await runHarness({
    utterances: [
      utter(p),
      report("Only accepted finding"),
      report("One answer"),
    ],
    observe: (e) => {
      if (e.type === "work:plan") ps = e.state;
      if (e.type === "work:start") turn = e.turnId;
    },
    script: [
      {
        send: { type: "submit_query", query: "Plan two checks", mode: "Plan" },
      },
      {
        on: (e) => e.type === "work:plan",
        send: () => ({
          type: "revise_plan",
          turnId: turn,
          revision: ps.revision,
          plan: { ...ps.plan, tasks: [ps.plan.tasks[0]] },
        }),
      },
      {
        on: (e) => e.type === "work:plan" && e.state.revision === 2,
        send: () => ({
          type: "approve_plan",
          turnId: turn,
          revision: ps.revision,
        }),
      },
      { on: ended },
    ],
  });
  assert.equal(records(r.events).at(-1)?.turns[0].plan?.tasks.length, 1);
  assert.equal(records(r.events).at(-1)?.turns[0].answer, "One answer");
});
test("manual topology, capability feasibility, input references and cycles are checked beyond schema validity", () => {
  assert.throws(() => validatePlan(plan(), "Chain", [], []), /honour/);
  assert.throws(
    () =>
      validatePlan(
        { ...plan(), tasks: [{ ...task("a"), ability: "camera" }] },
        "Auto",
        [],
        [],
      ),
    /available/,
  );
  assert.throws(
    () => validatePlan({ ...plan(), inputs: ["missing"] }, "Auto", [], []),
    /evidence/,
  );
  assert.throws(
    () =>
      validatePlan(
        { ...plan("graph"), tasks: [task("a", ["b"]), task("b", ["a"])] },
        "Auto",
        [],
        [],
      ),
    /cycle/,
  );
  assert.throws(
    () =>
      validateDecision(
        {
          action: "answer",
          reason: "",
          presentation: "prose",
          clarification: "",
          plan: null,
        },
        "Parallel",
        [],
        [],
      ),
    /ignore/,
  );
  assert.throws(
    () =>
      validatePlan(
        { ...plan("graph"), tasks: [task("a", ["gone"])] },
        "Auto",
        [],
        [],
      ),
    /missing/,
  );
});
test("revision invalidates dependency descendants and incidental inherited premises, keeping independent findings", () => {
  const p = {
    ...plan("graph"),
    tasks: [task("a"), task("b", ["a"]), task("c"), task("d")],
  };
  const next = {
    ...p,
    tasks: p.tasks.map((t) =>
      t.id === "a" ? { ...t, instruction: "Changed premise" } : t,
    ),
  };
  const fs = new Map<string, Finding>(
    p.tasks.map((t) => [
      t.id,
      { task: t, text: t.id, influencedBy: t.id === "d" ? ["a"] : [] },
    ]),
  );
  assert.deepEqual([...retainedFindings(p, next, fs).keys()], ["c"]);
  assert.equal(retainedFindings(p, next, fs, true).size, 0);
});
test("a forced result cannot satisfy a dependency even when it contains plausible text", async () => {
  const p = plan("graph"),
    spawned: string[] = [],
    extensions: string[] = [],
    findings = new Map<string, Finding>();
  const a = {
    id: 1,
    result: "Looks valid but was capped",
    exitReason: "terminal_cap",
    failed: null,
  } as Agent;
  const ctx = {
    spine: {},
    canFit: () => true,
    *spawn(spec) {
      spawned.push(spec.key!);
      return a;
    },
    *waitFor() {
      return a;
    },
    *extendSpine(_q, text) {
      extensions.push(text);
      return 1;
    },
  } as PoolContext;
  await assert.rejects(
    run(() =>
      guardedShape(
        p,
        (t) => ({ key: t.id, content: t.instruction, systemPrompt: "" }),
        findings,
        function* () {},
      )(ctx),
    ),
    /without an accepted finding/,
  );
  assert.deepEqual(spawned, ["first"]);
  assert.equal(extensions.length, 0);
  assert.equal(findings.size, 0);
  assert.equal(
    acceptedOutcome({ result: "Some text", failed: "cancelled" }),
    false,
  );
});
test("typed tables persist and survive reopen without relying on branch state", async () => {
  const d = {
    action: "answer",
    reason: "A table makes the comparison clearer.",
    presentation: "table",
    clarification: "",
    plan: null,
  };
  let saved: Conversation;
  const r = await runHarness({
    utterances: [
      { kind: "text", text: JSON.stringify(d) },
      {
        kind: "tool",
        text: "",
        tool: {
          name: "report",
          args: {
            result: "The two choices differ.",
            sources: [],
            table: {
              columns: ["Choice", "Cost"],
              rows: [
                ["A", "$20"],
                ["B", "$30"],
              ],
            },
          },
        },
      },
    ],
    observe: (e) => {
      if (e.type === "conversation") saved = e.record;
    },
    script: [
      { send: { type: "submit_query", query: "Compare A and B as a table" } },
      { on: ended, send: () => ({ type: "open_conversation", id: saved.id }) },
      { on: (e) => e.type === "conversation:active" },
    ],
  });
  assert.deepEqual(records(r.events).at(-1)?.turns[0].payload?.table?.rows, [
    ["A", "$20"],
    ["B", "$30"],
  ]);
});

test("manual-mode grammars reject unsupported action and plan combinations before generation", () => {
  const direct = {
    action: "answer",
    reason: "Simple",
    presentation: "prose",
    clarification: "",
    plan: null,
  };
  assert.equal(decisionSchema("Auto").safeParse(direct).success, true);
  assert.equal(decisionSchema("Plan").safeParse(direct).success, false);
  assert.equal(
    decisionSchema("Auto").safeParse({ ...direct, action: "compose" }).success,
    false,
  );
  assert.equal(
    decisionSchema("Graph").safeParse(decision(plan("graph"))).success,
    false,
  );
  assert.equal(
    decisionSchema("Graph").safeParse(
      decision({ ...plan("graph"), review: true }),
    ).success,
    true,
  );
  assert.equal(
    decisionSchema("Chain").safeParse(decision(plan("parallel"))).success,
    false,
  );
});
test("a parked edited plan survives Stop without pretending its workers resumed", async () => {
  const p = { ...plan(), review: true };
  let saved: Conversation,
    turn = "",
    ps: PlanState;
  const r = await runHarness({
    utterances: [utter(p)],
    observe: (e) => {
      if (e.type === "conversation") saved = e.record;
      if (e.type === "work:start") turn = e.turnId;
      if (e.type === "work:plan") ps = e.state;
    },
    script: [
      {
        send: { type: "submit_query", query: "Plan two checks", mode: "Plan" },
      },
      {
        on: (e) => e.type === "work:plan",
        send: () => ({
          type: "revise_plan",
          turnId: turn,
          revision: ps.revision,
          plan: {
            ...ps.plan,
            tasks: [{ ...ps.plan.tasks[0], title: "Revised purpose" }],
          },
        }),
      },
      {
        on: (e) => e.type === "work:plan" && e.state.revision === 2,
        send: { type: "stop" },
      },
      { on: ended },
    ],
  });
  assert.equal(saved!.turns[0].status, "interrupted");
  assert.equal(saved!.turns[0].plan?.tasks[0].title, "Revised purpose");
  assert.equal(saved!.turns[0].answer, null);
  assert.equal(
    r.events.some((e) => e.type === "agent:spawn" && e.key === "first"),
    false,
  );
});
test("a source restriction is durable before it is announced and remains after Stop", async () => {
  const d = {
    action: "answer",
    reason: "Use no external evidence.",
    presentation: "prose",
    clarification: "",
    plan: null,
    sourceScope: { abilities: [], inputs: [] },
  };
  let saved: Conversation;
  const r = await runHarness({
    utterances: [{ kind: "text", text: JSON.stringify(d) }],
    observe: (e) => {
      if (e.type === "conversation") saved = e.record;
    },
    script: [
      { send: { type: "submit_query", query: "General knowledge only" } },
      { on: (e) => e.type === "work:scope", send: { type: "stop" } },
      { on: ended },
    ],
  });
  assert.ok(saved!.turns[0].sourceScope);
  assert.equal(saved!.turns[0].status, "interrupted");
  const acknowledged = r.events.findIndex((e) => e.type === "work:scope");
  const persisted = r.events.findIndex(
    (e) => e.type === "conversation" && !!e.record.turns[0].sourceScope,
  );
  assert.ok(persisted >= 0 && persisted < acknowledged);
});

test("Direct can return a typed checklist with exactly one agent and no decision pass", async () => {
  const payload = {
    kind: "checklist",
    result: "Before leaving:",
    sources: [],
    checklist: [{ text: "Keys", detail: "Bring the keys." }],
  };
  const r = await runHarness({
    utterances: [
      { kind: "tool", text: "", tool: { name: "report", args: payload } },
    ],
    script: [
      {
        send: {
          type: "submit_query",
          query: "Give me a checklist",
          mode: "Direct",
        },
      },
      { on: ended },
    ],
  });
  assert.equal(records(r.events).at(-1)?.turns[0].payload?.kind, "checklist");
  assert.equal(r.events.filter((e) => e.type === "agent:spawn").length, 1);
  assert.equal(
    r.events.some((e) => e.type === "work:plan"),
    false,
  );
});
