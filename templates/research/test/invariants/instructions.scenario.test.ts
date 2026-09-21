/**
 * What the app is for is said on every path an answer can take. `INSTRUCTIONS.purpose` reaches every agent that
 * thinks about the question; `INSTRUCTIONS.answers` reaches only the agent whose words the reader gets — so the
 * planner, whose output is a plan, never hears it. Read off the compiled prompts the engine traced: what the
 * model was actually given, not what the code meant to send. Presence only; whether a model obeys is a
 * question for a real model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTRUCTIONS } from "../../src/harness/instructions.js";
import { runHarness, accept, answer } from "./harness.js";
import type { HarnessRun, HarnessSpec } from "./harness.js";

const PURPOSE = "You help maintenance engineers investigate equipment failures.";
const ANSWERS = "Always name the part number.";
const plan = (...tasks: string[]): string =>
  JSON.stringify({ intent: "research", tasks: tasks.map((description) => ({ description })), clarifyQuestions: [] });

/** Each agent's own compiled prompt, in the order the agents ran. The shared spine header is rig's and carries no instructions. */
const agentPrompts = (run: HarnessRun): string[] =>
  (run.trace as unknown as { type: string; role?: string; promptText?: string }[])
    .filter((t) => t.type === "prompt:format" && t.role === "agentSuffix").map((t) => t.promptText ?? "");

async function instructed(spec: HarnessSpec): Promise<string[]> {
  const shipped = { ...INSTRUCTIONS };
  Object.assign(INSTRUCTIONS, { purpose: PURPOSE, answers: ANSWERS });
  try { return agentPrompts(await runHarness(spec)); } finally { Object.assign(INSTRUCTIONS, shipped); }
}
const told = (prompt: string, what: { purpose: boolean; answers: boolean }, who: string): void => {
  assert.equal(prompt.includes(PURPOSE), what.purpose, `${who}: purpose ${what.purpose ? "missing" : "present"}`);
  assert.equal(prompt.includes(ANSWERS), what.answers, `${who}: answer requirements ${what.answers ? "missing" : "present"}`);
};

for (const mode of ["flat", "deep"] as const) {
  test(`a planned ${mode} brief: the planner and each inquiry hear the purpose; only the settling pass hears how answers read`, async () => {
    const [planner, first, second, settling] = await instructed({
      utterances: [{ text: plan("one", "two"), kind: "text" }, { text: "f1", kind: "report" }, { text: "f2", kind: "report" }, { text: "settled", kind: "text" }],
      script: [{ send: { type: "submit_query", query: "Q?", mode } }, { on: (e) => e.type === "ui:plan_review", send: accept }, { on: (e) => e.type === "complete" }],
    });
    told(planner, { purpose: true, answers: false }, "the planner");
    told(first, { purpose: true, answers: false }, "the first inquiry");
    told(second, { purpose: true, answers: false }, "the second inquiry");
    told(settling, { purpose: true, answers: true }, "the settling pass");
  });
}

test("a plan of one: nothing settles it afterwards, so the lone inquiry hears how answers read", async () => {
  const [, lone] = await instructed({
    utterances: [{ text: plan("only"), kind: "text" }, { text: "found", kind: "report" }],
    script: [{ send: { type: "submit_query", query: "Q?", mode: "flat" } }, { on: (e) => e.type === "ui:plan_review", send: accept }, { on: (e) => e.type === "complete" }],
  });
  told(lone, { purpose: true, answers: true }, "the lone inquiry");
});

test("a direct ask and the follow-up into it both hear the purpose and how answers read", async () => {
  const [direct, followUp] = await instructed({
    utterances: [{ text: "A.", kind: "text" }, { text: "B.", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat", skipPlanner: true } },
      { on: (e) => e.type === "complete", send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      { on: (e) => e.type === "complete" },
    ],
  });
  told(direct, { purpose: true, answers: true }, "the direct ask");
  told(followUp, { purpose: true, answers: true }, "the follow-up");
});

test("an answer given straight from the trunk hears both", async () => {
  const prompts = await instructed({
    utterances: [
      { text: JSON.stringify({ intent: "clarify", tasks: [], clarifyQuestions: ["Which one?"] }), kind: "text" },
      { text: JSON.stringify({ intent: "passthrough", tasks: [], clarifyQuestions: [] }), kind: "text" },
      { text: "From the trunk.", kind: "text" },
    ],
    script: [{ send: { type: "submit_query", query: "Q?", mode: "flat" } }, { on: (e) => e.type === "ui:clarify", send: answer("This one.") }, { on: (e) => e.type === "complete" }],
  });
  told(prompts[prompts.length - 1], { purpose: true, answers: true }, "the answer from the trunk");
});

test("as shipped, the instructions are empty and add nothing", () => {
  assert.deepEqual({ ...INSTRUCTIONS }, { purpose: "", answers: "" });
});
