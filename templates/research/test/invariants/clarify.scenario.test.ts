/**
 * The clarify loop — the KV choreography with the most moving parts, and the
 * feature that makes ambiguous queries work: every round is a REAL turn in
 * the trunk, so the next planner fork attends the whole dialogue.
 *
 * The law walked here:
 *   round 1  — planner says clarify → commitTurn(query, questions): the
 *              atomic COLD-path commit that bootstraps the trunk (first-run
 *              clarify works because of this).
 *   round 2  — submit_clarification → prefillUser(answer) lands a DANGLING
 *              user half BEFORE the re-plan, so the planner's fork sees the
 *              answer in KV; the plan comes back research.
 *   settle   — the pair closes with prefillAssistant(findings), never
 *              commitTurn — the user side is committed exactly once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { runHarness, warmDeltas, sessionReleasesOf, docIdOfQuery } from "./harness.js";

const CLARIFY_JSON = JSON.stringify({
  intent: "clarify",
  tasks: [],
  clarifyQuestions: ["Which timeframe?", "Which region?"],
});
const RESEARCH_JSON = JSON.stringify({
  intent: "research",
  tasks: [{ description: "adoption since 2024, EU" }],
  clarifyQuestions: [],
});

test("clarify round-trip: cold bootstrap → split-half answer → pair closed once", async () => {
  const run = await runHarness({
    utterances: [
      { text: CLARIFY_JSON, kind: "text" },              // round-1 planner
      { text: RESEARCH_JSON, kind: "text" },             // round-2 planner (sees the answer via KV)
      { text: "EU adoption findings.", kind: "report" }, // the research agent
    ],
    script: [
      { send: { type: "submit_query", query: "Compare adoption", mode: "flat" } },
      // The answer fires the instant the plan event lands — the harshest
      // client timing. The park arms a hop later and the round-1 commit is
      // still in flight; the handler absorbs both (early-arm + settle-await).
      { on: (ev) => ev.type === "plan" && (ev as { intent: string }).intent === "clarify",
        send: { type: "submit_clarification", answer: "Since 2024, EU only." } },
      { on: (ev) => ev.type === "ui:plan_review", send: { type: "accept_plan" } },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  // The wire: two plans (clarify, then research), ONE identity throughout.
  const plans = run.events.filter((e) => e.type === "plan") as { intent: string }[];
  assert.deepEqual(plans.map((p) => p.intent), ["clarify", "research"]);
  const queries = run.events.filter((e) => e.type === "query") as { docId: string }[];
  assert.ok(queries.every((q) => q.docId === queries[0].docId), "one docId across every round");

  // The trunk, in order, all on ONE handle:
  //   [turn]      round-1 bootstrap — the query paired with the questions
  //   [user]      the dangling answer half, BEFORE the re-plan
  //   [assistant] the findings closing the pair at settle
  const deltas = warmDeltas(run.trace);
  assert.deepEqual(deltas.map((d) => d.speaker), ["turn", "user", "assistant"]);
  assert.ok(deltas[0].content?.includes("I need to clarify"));
  assert.ok(deltas[0].content?.includes("Which timeframe?"));
  assert.ok(deltas[1].content?.includes("Since 2024, EU only."));
  assert.ok(deltas[2].content?.includes("EU adoption findings."));
  assert.equal(new Set(deltas.map((d) => d.branchHandle)).size, 1, "one trunk, cold-bootstrapped by round 1");
  assert.equal(sessionReleasesOf(run, deltas[0].branchHandle!).length, 0);

  // The no-duplicate law: the user's answer entered the KV exactly once —
  // the settle was a pair-CLOSE (assistant half), never a second commit.
  const userSides = deltas.filter((d) => d.speaker === "user" || d.speaker === "turn");
  assert.equal(userSides.length, 2, "round-1 turn + the one answer half; nothing else user-side");

  // And the brief settled on disk under the round-1 identity.
  assert.ok(fs.existsSync(path.join(run.outputDir, docIdOfQuery(run.events), "report.md")));
});
