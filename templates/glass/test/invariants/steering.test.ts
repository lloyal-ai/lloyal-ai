import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness } from "./harness.js";
import { validateDirection } from "../../src/harness/steering.js";
import { WorkControl } from "../../src/harness/work.js";
import type { Plan, PlanState } from "../../src/domain/work.js";
import type { Conversation, WorkflowEvent } from "../../src/protocol.js";
const plan: Plan = {
  objective: "Compare",
  reason: "Two checks",
  topology: "parallel",
  presentation: "prose",
  tasks: [
    {
      id: "one",
      title: "First",
      instruction: "Check one",
      ability: "",
      dependsOn: [],
    },
  ],
  review: true,
  preflight: false,
  revisit: false,
  inputs: [],
};
const proposal = {
  kind: "text" as const,
  text: JSON.stringify({
    action: "compose",
    reason: "Useful checks",
    presentation: "prose",
    clarification: "",
    plan,
  }),
};
const report = (text: string) => ({ kind: "report" as const, text });
const ended = (e: WorkflowEvent) => e.type === "work:ended";

test("a semantic direction is saved before interpreting it and preserves the parked work", async () => {
  let saved: Conversation,
    turn = "",
    ps: PlanState;
  const r = await runHarness({
    utterances: [
      proposal,
      {
        kind: "text",
        text: JSON.stringify({
          kind: "presentation",
          reason: "Keep the check; shorten its answer",
          presentation: "prose",
          plan: null,
          clarification: "",
          abilities: [],
          inputs: [],
        }),
      },
      report("The finding"),
      report("A shorter answer"),
    ],
    observe: (e) => {
      if (
        process.env.GLASS_TEST_DEBUG &&
        ["ui:error", "work:plan", "work:phase", "work:ended"].includes(e.type)
      )
        console.log(e);
      if (e.type === "conversation") saved = e.record;
      if (e.type === "work:start") turn = e.turnId;
      if (e.type === "work:plan") ps = e.state;
    },
    script: [
      {
        send: {
          type: "submit_query",
          query: "Compare the options",
          mode: "Plan",
        },
      },
      {
        on: (e) => e.type === "work:plan",
        send: () => ({
          type: "steer_work",
          turnId: turn,
          revision: saved.revision,
          query: "Keep the same work, but make the answer shorter.",
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
  assert.equal(saved!.turns[0].answer, "A shorter answer");
  assert.equal(saved!.turns[0].directions.length, 1);
  const persisted = r.events.findIndex(
    (e) =>
      e.type === "conversation" && e.record.turns[0].directions.length === 1,
  );
  const revised = r.events.findIndex(
    (e) => e.type === "work:plan" && e.state.revision === 2,
  );
  assert.ok(persisted >= 0 && persisted < revised);
  assert.deepEqual(saved!.turns[0].plan!.tasks, plan.tasks);
});
test("Finish while paused is refused until explicit Resume, then keeps a partial answer without starting parked tasks", async () => {
  let saved: Conversation,
    turn = "";
  const r = await runHarness({
    utterances: [
      proposal,
      report("No checks were completed; this is only an outline."),
    ],
    observe: (e) => {
      if (
        process.env.GLASS_TEST_DEBUG &&
        ["ui:error", "work:plan", "work:phase", "work:ended"].includes(e.type)
      )
        console.log(e);
      if (e.type === "conversation") saved = e.record;
      if (e.type === "work:start") turn = e.turnId;
    },
    script: [
      {
        send: {
          type: "submit_query",
          query: "Plan the comparison",
          mode: "Plan",
        },
      },
      { on: (e) => e.type === "work:plan", send: { type: "pause" } },
      {
        on: (e) => e.type === "work:paused" && e.paused,
        send: () => ({ type: "finish_work", turnId: turn }),
      },
      { on: (e) => e.type === "ui:error", send: { type: "resume" } },
      {
        on: (e) => e.type === "work:paused" && !e.paused,
        send: () => ({ type: "finish_work", turnId: turn }),
      },
      { on: ended },
    ],
  });
  assert.equal(saved!.turns[0].status, "partial");
  assert.ok(saved!.turns[0].answer?.includes("No checks"));
  assert.ok(r.events.some((e) => e.type === "ui:error"));
  assert.ok(r.events.some((e) => e.type === "work:paused" && !e.paused));
  assert.equal(
    r.events.some((e) => e.type === "agent:spawn" && e.key === "one"),
    false,
  );
});
test("scope validation refuses invented capabilities and hidden task changes", () => {
  const d = {
    kind: "presentation",
    reason: "shorter",
    presentation: "prose",
    plan: null,
    clarification: "",
    abilities: [],
    inputs: [],
  };
  assert.throws(
    () =>
      validateDirection({ ...d, abilities: ["camera"] }, "Auto", plan, [], []),
    /unavailable/,
  );
  assert.throws(
    () =>
      validateDirection({ ...d, inputs: ["missing"] }, "Auto", plan, [], []),
    /unavailable/,
  );
  assert.throws(
    () =>
      validateDirection(
        { ...d, plan: { ...plan, tasks: [] } },
        "Auto",
        plan,
        [],
        [],
      ),
    /small|work|tasks/i,
  );
  const c = new WorkControl("Auto");
  c.requestDirection("Shorter");
  assert.throws(() => c.requestDirection("Different"), /settle/);
});
test("stale steering does not overwrite the durable question", async () => {
  let saved: Conversation,
    turn = "";
  const r = await runHarness({
    utterances: [proposal],
    observe: (e) => {
      if (
        process.env.GLASS_TEST_DEBUG &&
        ["ui:error", "work:plan", "work:phase", "work:ended"].includes(e.type)
      )
        console.log(e);
      if (e.type === "conversation") saved = e.record;
      if (e.type === "work:start") turn = e.turnId;
    },
    script: [
      { send: { type: "submit_query", query: "Plan", mode: "Plan" } },
      {
        on: (e) => e.type === "work:plan",
        send: () => ({
          type: "steer_work",
          turnId: turn,
          revision: 999,
          query: "Replace everything",
        }),
      },
      { on: (e) => e.type === "ui:error", send: { type: "stop" } },
      { on: ended },
    ],
  });
  assert.equal(saved!.turns[0].question, "Plan");
  assert.equal(saved!.turns[0].directions.length, 0);
  assert.ok(
    r.events.some(
      (e) => e.type === "ui:error" && e.message.includes("changed"),
    ),
  );
});
