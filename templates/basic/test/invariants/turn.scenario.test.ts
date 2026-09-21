/**
 * One cold turn, end to end, through the real `harness(ctx, events, commands)`.
 *
 * This is the scenario the rest of the arc is rewritten under. Its load-bearing
 * assertion is not that an answer arrived — it is that the answer is EXACTLY the
 * text the settling agent was scripted to say. basic has a fallback: when no
 * findings come back it answers with the agents' notes joined together, which
 * reads like a perfectly good answer. So "an answer exists" would stay green
 * through a pool wired to the wrong keys or a settling agent whose free text was
 * refused — both of which return prose built from the wrong source. Only the
 * exact text tells those apart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, answerOf, typesOf } from "./harness.js";
import type { Utterance } from "./harness.js";

/** What the settling agent says, and therefore what the reader must be shown, byte for byte.
 *  Deliberately free of `<think>` and `<tool_call>` so the engine's report cleanup is the identity here. */
const SETTLED = "## Thesis\n\nSolid-state cells are near, not here.\n\n## Bottom line\n\nWatch the 2027 lines.";

/** Two angles report, then the settling agent returns prose. Utterances are assigned in
 *  first-sample order, and the shared spine does not sample — so this is angle 0, angle 1, settle. */
const SCRIPT: Utterance[] = [
  { kind: "report", text: "Angle one: the core facts.", sources: [{ title: "A", url: "https://example.com/a" }] },
  { kind: "report", text: "Angle two: the context.", sources: [{ title: "B", url: "https://example.com/b" }] },
  { kind: "text", text: SETTLED },
];

test("a cold question is researched, settled, and answered in the settling agent's own words", async () => {
  const run = await runHarness({
    utterances: SCRIPT,
    script: [
      { send: { type: "submit_query", query: "are solid-state batteries ready?" } },
      { on: (ev) => ev.type === "answer" },
    ],
  });

  const types = typesOf(run.events);

  // The turn is announced before any work, so a surface knows a turn began without
  // inferring it from the first spawn.
  assert.ok(types.includes("query"), `no query event on the wire: ${types.join(", ")}`);
  assert.ok(types.indexOf("query") < types.indexOf("answer"), "the turn must be announced before it is answered");

  // Every angle got an agent, and the settling pass got one too.
  const spawns = run.events.filter((e) => e.type === "agent:spawn").length;
  assert.ok(spawns >= 3, `expected an agent per angle plus the settling agent, saw ${spawns}`);

  // The one that matters: the reader is shown what the settling agent actually said.
  assert.equal(answerOf(run.events), SETTLED);
});
