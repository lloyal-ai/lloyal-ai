/**
 * `stop` ends the turn in flight, and the page keeps whatever it already had.
 *
 * The load-bearing half is the SECOND assertion, not the first. "The turn ended" is easy to get right by
 * accident; "nothing reached the trunk" is the one that catches a stop which halted the agents but let the
 * commit through behind it — an article the reader never saw and never asked to keep, which the next
 * question would then silently deepen. A trunk commit is a `branch:prefill` with `role='warmDelta'` in the
 * trace, so `warmDeltas` is the honest way to ask, and it reads the trace rather than the wire because the
 * wire is exactly what a leaked commit would not appear on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, typesOf, warmDeltas } from "./harness.js";
import type { Utterance } from "./harness.js";

/** Long stalls, so the turn is unambiguously still in flight when `stop` lands. */
const SLOW: Utterance[] = [
  { kind: "report", text: "Angle one.", stallTokens: 400 },
  { kind: "report", text: "Angle two.", stallTokens: 400 },
  { kind: "text", text: "An article nobody should be shown." },
];

test("stop ends the turn without answering, and commits nothing", async () => {
  const run = await runHarness({
    utterances: SLOW,
    script: [
      { send: { type: "submit_query", query: "a question we stop" } },
      // The first spawn proves the turn is under way; stop goes in behind it.
      { on: (ev) => ev.type === "agent:spawn", send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted" },
    ],
  });

  const types = typesOf(run.events);
  assert.ok(types.includes("query"), "the turn should still have been announced");
  assert.ok(types.includes("run:aborted"), `the turn's end was never said: ${types.slice(-6).join(" → ")}`);
  assert.ok(
    !types.includes("answer"),
    `a stopped turn answered anyway (${run.events.length} events, ending: ${types.slice(-6).join(" → ")})`,
  );
  assert.equal(
    warmDeltas(run.trace).length,
    0,
    "a stopped turn reached the trunk — the reader would be deepening an article they never saw",
  );
});

test("the session survives a stop: the next question is answered normally", async () => {
  // A stop is not a session ending. `run.replace` sequences the next operation behind the halted one's
  // cleanup, so the proof that the cleanup is honest is simply that a second question works.
  //
  // This one asserts SHAPE, not text, and the reason is worth keeping: utterances are a shared queue
  // assigned in first-sample order, and how many the stopped turn consumed depends on whether its agents
  // reached their first sample before the halt — a race this test has no business pinning. The cold-turn
  // scenario is where exact text is load-bearing, because there the wrong source yields a plausible answer.
  const run = await runHarness({
    utterances: [
      ...SLOW,
      { kind: "report", text: "Angle one, again." },
      { kind: "report", text: "Angle two, again." },
      { kind: "text", text: "## A second article" },
    ],
    script: [
      { send: { type: "submit_query", query: "the one we stop" } },
      { on: (ev) => ev.type === "agent:spawn", send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted", send: { type: "submit_query", query: "the one we keep" } },
      { on: (ev) => ev.type === "answer" },
    ],
  });

  const types = typesOf(run.events);
  const answers = run.events.filter((e) => e.type === "answer") as { text: string }[];
  assert.equal(answers.length, 1, "the stopped turn must not answer, and the second one must");
  assert.ok(answers[0].text.length > 0, "the second turn answered with nothing");
  assert.ok(
    types.indexOf("run:aborted") < types.indexOf("answer"),
    "the answer must belong to the turn asked AFTER the stop",
  );
  assert.equal(
    types.filter((t) => t === "run:aborted").length,
    1,
    "only the stopped turn ended that way — a second abort means the recovery turn died too",
  );
});
