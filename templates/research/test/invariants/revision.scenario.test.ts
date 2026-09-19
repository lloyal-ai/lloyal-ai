/**
 * The revision names the planning round. `ui:plan_review` and `ui:clarify`
 * announce the round the brief armed; a yes, an answer or an edit must name it
 * back, and a round that is over — consumed, superseded, stopped — is refused
 * or finds nothing. The laws: a stale yes is refused with a toast and the plan
 * stays parked; a second yes finds nothing; a stale edit changes nothing; a
 * changed mode supersedes the round, so the old revision is refused and the
 * new one proceeds; an answer followed at once by Stop never runs its planner;
 * `stop` with a plan parked releases the folder and says `run:aborted`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { runHarness, docIdOfQuery, accept, answer, revision, dirs } from "./harness.js";
import type { WorkflowEvent } from "../../src/brief/protocol.js";

const PLAN_JSON = JSON.stringify({ intent: "research", tasks: [{ description: "investigate the topic" }], clarifyQuestions: [] });
const CLARIFY_JSON = JSON.stringify({ intent: "clarify", tasks: [], clarifyQuestions: ["Which one?"] });
const STALE = /plan changed under you/;
const toasts = (events: readonly WorkflowEvent[]): string[] =>
  events.filter((e) => e.type === "ui:error").map((e) => (e as { message: string }).message);
/** The tasks the run actually worked: each inquiry's annexure names the task it was given. */
const tasksWorked = (outputDir: string, docId: string): string[] => {
  const dir = path.join(outputDir, docId);
  return fs.readdirSync(dir).filter((f) => /^annexure-\d+\.md$/.test(f)).sort()
    .map((f) => /\*\*Task:\*\* (.*)/.exec(fs.readFileSync(path.join(dir, f), "utf8"))?.[1] ?? "");
};

test("plan review: a stale yes is refused and the plan stays parked; the right yes runs it; a second yes finds nothing", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "findings", kind: "report", stallTokens: 40 },
      { text: "Settled answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: { type: "accept_plan", revision: 999 } },
      { on: (ev) => ev.type === "ui:error", send: { type: "update_task_description", revision: 999, index: 0, description: "changed" } },
      { on: (ev) => ev.type === "ui:error", send: accept },
      { on: (ev) => ev.type === "research:start", send: accept },   // a second yes, to a round already consumed
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.deepEqual(toasts(run.events).map((m) => STALE.test(m)), [true, true], "the stale yes and the stale edit were refused, nothing else toasted");
  assert.equal(run.events.filter((e) => e.type === "plan").length, 1, "a stale edit changes nothing: the plan was never said again");
  assert.equal(run.events.filter((e) => e.type === "research:start").length, 1, "one run: the second yes found nothing");
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 0);
  assert.deepEqual(tasksWorked(run.outputDir, docIdOfQuery(run.events)), ["investigate the topic"], "the parked plan was untouched by the stale edit");
  assert.ok(fs.existsSync(path.join(run.outputDir, docIdOfQuery(run.events), "report.md")));
});

test("an edit at the announced revision changes the parked plan, and the accepted run carries it", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "findings", kind: "report" },
      { text: "Settled answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: () => ({ type: "update_task_description", revision: revision(), index: 0, description: "look closer" }) },
      // The edit is answered with the plan, said again as it now stands.
      { on: (ev) => ev.type === "plan" && (ev as { tasks: { description: string }[] }).tasks[0]?.description === "look closer", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.deepEqual(tasksWorked(run.outputDir, docIdOfQuery(run.events)), ["look closer"], "the inquiry worked the edited task");
});

test("a changed mode supersedes the round: the old revision is refused, the new one proceeds", async () => {
  let first = 0;
  const run = await runHarness({
    utterances: [
      { text: CLARIFY_JSON, kind: "text" },   // round 1
      { text: CLARIFY_JSON, kind: "text" },   // round 2, after the mode change
      { text: PLAN_JSON, kind: "text" },      // round 3, after the answer
      { text: "findings", kind: "report" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => { if (ev.type === "ui:clarify") first = ev.revision; return ev.type === "ui:clarify"; }, send: { type: "change_mode", mode: "deep" } },
      { on: (ev) => ev.type === "ui:clarify" && ev.revision !== first, send: () => ({ type: "submit_clarification", revision: first, answer: "late" }) },
      { on: (ev) => ev.type === "ui:error", send: answer("This one.") },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const rounds = run.events.filter((e) => e.type === "ui:clarify") as { revision: number }[];
  assert.equal(rounds.length, 2);
  assert.notEqual(rounds[1].revision, rounds[0].revision, "a new round, a new revision");
  assert.deepEqual(toasts(run.events).map((m) => STALE.test(m)), [true], "the late answer to the superseded round was refused");
  const plans = run.events.filter((e) => e.type === "plan") as { intent: string }[];
  assert.deepEqual(plans.map((p) => p.intent), ["clarify", "clarify", "research"]);
  const queries = run.events.filter((e) => e.type === "query") as { docId: string }[];
  assert.ok(queries.every((q) => q.docId === queries[0].docId), "one identity across every round");
  assert.ok(fs.existsSync(path.join(run.outputDir, docIdOfQuery(run.events), "report.md")));
});

test("an answer followed at once by Stop: Stop is processed, and the round's planner never runs", async () => {
  const run = await runHarness({
    utterances: [
      { text: CLARIFY_JSON, kind: "text" },
      { text: PLAN_JSON, kind: "text", stallTokens: 400 },   // would be round 2's planner
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:clarify", send: answer("This one.") },
      { send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted", send: { type: "library_list" } },
      { on: (ev) => ev.type === "library:list" },
    ],
  });
  const plans = run.events.filter((e) => e.type === "plan") as { intent: string }[];
  assert.deepEqual(plans.map((p) => p.intent), ["clarify"], "the second round never planned");
  assert.equal(run.events.filter((e) => e.type === "plan:start").length, 1);
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1);
});

test("stop with a plan parked releases its folder and says run:aborted", async () => {
  const run = await runHarness({
    utterances: [{ text: PLAN_JSON, kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted" },
    ],
  });
  assert.deepEqual(dirs(run.outputDir), [], "the parked brief's reservation is gone");
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1);
});
