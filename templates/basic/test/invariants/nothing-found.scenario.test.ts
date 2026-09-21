/**
 * When the angles come back empty the turn says so and keeps nothing.
 *
 * The rule it pins is that the app never invents prose its sources do not support. basic used to answer
 * "No findings — the agents returned nothing." as the ARTICLE, which then went onto the trunk: a sentence the
 * model never wrote became the page the next question would deepen. Now the answer is `null`, no trunk write
 * happens, and the words the reader sees belong to the view.
 *
 * `answer` still fires — that is why it carries `text: string | null`. A surface must never have to infer
 * "the turn is over" from silence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, typesOf, warmDeltas } from "./harness.js";

test("angles that find nothing answer with null and commit nothing", async () => {
  const run = await runHarness({
    utterances: [
      { kind: "report", text: "" },
      { kind: "report", text: "" },
    ],
    script: [
      { send: { type: "submit_query", query: "a question nothing answers" } },
      { on: (ev) => ev.type === "answer" },
    ],
  });

  const answer = run.events.find((e) => e.type === "answer") as { text: string | null } | undefined;
  assert.ok(answer, `the turn never said it was over: ${typesOf(run.events).join(", ")}`);
  assert.equal(answer.text, null, "empty findings must not be dressed up as an article");
  assert.equal(
    warmDeltas(run.trace).length,
    0,
    "a turn that found nothing reached the trunk — the next question would deepen a page nobody wrote",
  );
});
