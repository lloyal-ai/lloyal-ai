/**
 * The turn, across the cases that actually differ: a follow-up on a warm trunk, an angle that finds nothing
 * while its sibling does, and a settling agent that produces no prose.
 *
 * The cold/both-report/settles row is `turn.scenario`; neither-reports is `nothing-found.scenario`. What is
 * here is the rest of the grid — the rows where a plausible-looking answer can come from the wrong place.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, typesOf, warmDeltas } from "./harness.js";
import type { WorkflowEvent } from "../../src/protocol.js";

const answers = (events: readonly WorkflowEvent[]): (string | null)[] =>
  events.filter((e) => e.type === "answer").map((e) => (e as { text: string | null }).text);

const queries = (events: readonly WorkflowEvent[]) =>
  events.filter((e): e is Extract<WorkflowEvent, { type: "query" }> => e.type === "query");

test("a follow-up runs warm, and is answered with the extended article", async () => {
  const run = await runHarness({
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
      { kind: "report", text: "Angle one, again." },
      { kind: "report", text: "Angle two, again." },
      { kind: "text", text: "## The article, extended" },
    ],
    script: [
      { send: { type: "submit_query", query: "what is the Antikythera mechanism?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 1 },
      { send: { type: "submit_query", query: "who built it?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
    ],
  });

  const asked = queries(run.events);
  assert.equal(asked.length, 2);
  assert.equal(asked[0].warm, false, "the first question has no trunk to deepen");
  assert.equal(asked[1].warm, true, "the second must see the trunk the first committed");
  assert.deepEqual(answers(run.events), ["## The article", "## The article, extended"]);
  assert.ok(
    warmDeltas(run.trace).length >= 2,
    "each settled turn commits to the trunk — without that the follow-up would start cold",
  );
});

test("one angle silent, the other found something: the article is still written", async () => {
  // The settling agent is given the notes that exist. An empty angle must not take the turn down with it,
  // and must not leave a gap that the notes-index numbering papers over.
  //
  // The silent angle reports whitespace rather than "": the rig assigns utterances by the text a turn
  // PRODUCES, so two empty ones are indistinguishable and both agents would take the same fixture. Whitespace
  // is distinct to the rig and still empty to the app, which is exactly the case under test.
  const run = await runHarness({
    utterances: [
      { kind: "report", text: "   " },
      { kind: "report", text: "Only this angle found anything." },
      { kind: "text", text: "## Written from one angle" },
    ],
    script: [
      { send: { type: "submit_query", query: "half a question" } },
      { on: (ev) => ev.type === "answer" },
    ],
  });

  assert.deepEqual(answers(run.events), ["## Written from one angle"]);
});

test("the angles report but the settling agent writes nothing: no article, nothing kept", async () => {
  // The last place an empty answer could slip through as prose. `write` returns null rather than handing the
  // reader whitespace, and because it is null nothing reaches the trunk or the disk.
  const run = await runHarness({
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "   " },
    ],
    script: [
      { send: { type: "submit_query", query: "a question the settle fumbles" } },
      { on: (ev) => ev.type === "answer" },
    ],
  });

  assert.deepEqual(answers(run.events), [null], "whitespace is not an article");
  assert.equal(warmDeltas(run.trace).length, 0, "nothing was written, so nothing may reach the trunk");
  // The shelf is always SAID at boot; what matters is that it never gained anything.
  const shelved = run.events.filter((e): e is Extract<WorkflowEvent, { type: "library" }> => e.type === "library");
  assert.ok(shelved.every((s) => s.articles.length === 0), "…and nothing was added to the shelf");
});
