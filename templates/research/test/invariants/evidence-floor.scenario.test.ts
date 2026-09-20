/**
 * The evidence floor is this harness's, stated on its policies as a hook: a
 * research agent that reports before two tool calls is refused once with the
 * floor's message, then its report stands. The framework carries no floor of
 * its own any more, so this law is what keeps the floor alive through the
 * template migration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runHarness, accept,
} from "./harness.js";

const PLAN_JSON = JSON.stringify({
  intent: "research",
  tasks: [{ description: "investigate the topic" }],
  clarifyQuestions: [],
});
import { EVIDENCE_REJECTION as FLOOR } from "../../src/research/research.js";

test("a research agent that reports before two tool calls is nudged once with the floor's message, then its report stands", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "findings", kind: "report" },
      { text: "Settled answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const nudges = run.trace.filter((t) => t.type === "pool:agentNudge") as { agentId: number; message?: string }[];
  assert.deepEqual(nudges.map((n) => n.message), [FLOOR], "one nudge, the floor's, never a second");
  const returns = run.events.filter((e) => e.type === "agent:return") as { agentId: number; result: string }[];
  assert.equal(returns.length, 1, "the same report stood when it came again");
  assert.equal(returns[0].agentId, nudges[0].agentId);
  assert.match(returns[0].result, /findings/);
});
