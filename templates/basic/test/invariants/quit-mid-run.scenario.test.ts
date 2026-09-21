/**
 * `quit` arriving while a turn is in flight must END the run, not queue behind it.
 *
 * SKIPPED until the command loop moves to `serveCommands` + `useExecution` (step 6
 * of the basic arc). Today `app.ts` awaits `runQuery` inside its own `for (const cmd
 * of yield* each(commands))`, so the loop is not reading commands while the model
 * works: a `quit` sent mid-turn is buffered by the signal and acted on only once the
 * answer has already been produced and committed. That is exactly the behaviour the
 * step changes — `submit` will hand the work to `run.replace(...)` and stop awaiting
 * it — so this test is written now, red, and turned on there rather than written
 * afterwards to describe whatever the rewrite happened to do.
 *
 * Kept skipped rather than failing so the suite stays a usable gate for every other
 * step; the cost is that it must actually be un-skipped, which is why step 6 names it.
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

test.skip("quit during a turn ends the run without answering [un-skip at arc step 6]", async () => {
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
