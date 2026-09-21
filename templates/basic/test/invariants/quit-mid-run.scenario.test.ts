/**
 * `quit` arriving while a turn is in flight must END the run, not queue behind it.
 *
 * The loop must be free while the model works: `submit` hands its work to `run` and returns, so a `quit`
 * arriving mid-turn is dispatched rather than buffered behind the answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, typesOf } from "./harness.js";
import type { Utterance } from "./harness.js";

/** Long stalls so the turn is unambiguously still in flight when `quit` lands. */
const SLOW: Utterance[] = [
  { kind: "report", text: "Angle one.", stallTokens: 400 },
  { kind: "report", text: "Angle two.", stallTokens: 400 },
  { kind: "text", text: "A settled answer nobody should be shown." },
];

test("quit during a turn ends the run without answering", async () => {
  const run = await runHarness({
    utterances: SLOW,
    script: [
      { send: { type: "submit_query", query: "a question we abandon" } },
      // The first spawn proves the turn is under way; quit goes in behind it.
      { on: (ev) => ev.type === "agent:spawn", send: { type: "quit" } },
    ],
  });

  const types = typesOf(run.events);
  assert.ok(types.includes("query"), "the turn should still have been announced");
  assert.ok(
    !types.includes("answer"),
    // Summarise rather than dump: a stalled run carries hundreds of `agent:produce`
    // ticks, and a failure message nobody can read is a failure message nobody uses.
    `quit was heard only after the turn finished — the wire carried an answer ` +
      `(${run.events.length} events, ending: ${types.slice(-6).join(" → ")})`,
  );
});
