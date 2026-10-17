/**
 * A run that fails after some inquiries finished ends as an unsettled brief: the finished findings are the
 * answer, marked with why they were not settled, and nothing that finished is lost — on disk or on the canvas.
 * Each inquiry's annexure is filed as its report returns, so a run killed mid-way leaves what it had, listed on
 * restart as unsettled; a settling pass whose decode fails for room ends the same way a refused one does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { suspend } from "effection";
import { runHarness, accept, composed, docIdOfQuery, warmDeltas } from "./harness.js";
import type { Utterance } from "./harness.js";
import { asBriefRecord } from "../../src/harness/library.js";
import * as research from "../../src/harness/research.js";
import type { Research } from "../../src/harness/research.js";
import type { WorkflowEvent } from "../../src/protocol.js";
import { UNSETTLED } from "../../src/protocol.js";
import { reduce, initialState } from "../../src/ui/state.js";
import { selectSections, selectStatus } from "../../src/ui/select.js";

const THREE_TASKS = JSON.stringify({ intent: "research", tasks: [{ description: "one" }, { description: "two" }, { description: "THIRD-TASK" }], clarifyQuestions: [] });

/** An investigation of three stages: the planner's plan, then what each stage finds. */
const threeStages: Utterance[] = [
  { text: THREE_TASKS, kind: "text" },
  { text: "FIRST-FINDING", kind: "report" },
  { text: "SECOND-FINDING", kind: "report" },
  { text: "THIRD-FINDING", kind: "report" },
  { text: "the settled brief", kind: "text" },
];

const investigation = (last: (ev: WorkflowEvent) => boolean) => [
  { send: { type: "submit_query" as const, query: "Q?", mode: "deep" as const } },
  { on: (ev: WorkflowEvent) => ev.type === "ui:plan_review", send: accept },
  { on: last },
];

/** Three stages need an effort whose plan may hold three tasks; the rig's own default, `low`, holds two. */
const threeTasksAllowed = { defaults: { effort: "medium" as const } };

const annexures = (dir: string): string[] => fs.readdirSync(dir).filter((f) => /^annexure-\d+\.md$/.test(f)).sort();

test("a run that fails after two of three stages ends as an unsettled brief: the two findings are the answer, filed, and the reader is told why", async () => {
  const run = await runHarness({
    config: threeTasksAllowed,
    utterances: threeStages,
    // The third stage's spawn cannot be priced: a programming error on the way to its seat, which fails the pool.
    // In an investigation the third task's description reaches the model only in that spawn's own prompt.
    instrument: (c) => {
      const inner = c.formatChatSync.bind(c);
      c.formatChatSync = (msgs, opts) => {
        if (msgs.includes("THIRD-TASK")) throw new Error("the third inquiry could not be priced");
        return inner(msgs, opts);
      };
    },
    script: investigation((ev) => ev.type === "complete" || ev.type === "run:aborted"),
  });

  const answer = run.events.find((e) => e.type === "answer") as { text: string | null; unsettled?: string } | undefined;
  assert.ok(answer, "the run said its answer");
  assert.ok(answer.text?.includes("FIRST-FINDING") && answer.text.includes("SECOND-FINDING"), "the finished findings are the answer");
  assert.ok(!answer.text.includes("THIRD-FINDING"));
  assert.equal(answer.unsettled, "failed", "the answer says the run failed before they were settled");
  assert.ok(run.events.some((e) => e.type === "complete"), "the run completed as an unsettled brief");
  assert.ok(!run.events.some((e) => e.type === "run:aborted"), "a run with findings is not aborted");
  const told = run.events.find((e) => e.type === "ui:error") as { message: string } | undefined;
  assert.ok(told?.message.includes("the third inquiry could not be priced"), `the reader is told why, in the engine's words: ${run.events.map((e) => e.type).join(" ")}`);
  assert.equal(warmDeltas(run.trace).length, 1, "the findings joined the trunk as the answer, once");

  // The canvas: two sections with their prose, the answer as written, the run bar Incomplete.
  const s = run.events.reduce(reduce, initialState);
  const docId = docIdOfQuery(run.events);
  const doc = s.documents.get(docId)!;
  assert.equal(doc.phase, "done");
  assert.equal(doc.unsettled, "failed");
  const sections = selectSections(s);
  assert.equal(sections[0].prose, "FIRST-FINDING");
  assert.equal(sections[1].prose, "SECOND-FINDING");
  assert.equal(selectStatus(s), "Incomplete");

  // The disk: the two annexures, and a record that says what the run kept and why it stopped there.
  const dir = path.join(run.outputDir, docId);
  assert.deepEqual(annexures(dir), ["annexure-1.md", "annexure-2.md"]);
  const record = asBriefRecord(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  assert.equal(record?.unsettled, "failed");
  assert.deepEqual(record?.inquiries.map((i) => i.findings), ["FIRST-FINDING", "SECOND-FINDING", ""]);
  const report = fs.readFileSync(path.join(dir, "report.md"), "utf8");
  assert.ok(report.includes(UNSETTLED.failed), "the saved report says, as the canvas does, why it was not settled");
});

test("a run killed after two of three stages leaves the two annexures and an unsettled record on disk", async () => {
  let halt: (() => Promise<void>) | null = null;
  // The stock investigation up to its second stage; then the session ends the way a disconnect ends it, before a
  // third stage is ever asked for. The strategy is the stock writer's with the stages spelled out, so the second
  // report has been kept the moment `waitFor` returns it.
  const killedAfterTwo: Research["write"] = (trunk, ask, plan, stages) =>
    research.write(trunk, ask, plan, {
      ...stages,
      inquire: (_ask, tasks, specFor) => function* (ctx) {
        for (const [i, task] of tasks.slice(0, 2).entries()) {
          const agent = yield* ctx.waitFor(yield* ctx.spawn(specFor(task, i, false)));
          if (agent.result) yield* ctx.extendSpine(research.nextTask(task), agent.result);
        }
        // A halt is a future: it begins when it is awaited, so the promise is taken up, not discarded.
        void halt!().catch(() => undefined);
        yield* suspend();
      },
    });
  const run = await runHarness({
    harness: composed({ ...research, write: killedAfterTwo }),
    config: threeTasksAllowed,
    utterances: threeStages,
    controls: (c) => { halt = c.halt; },
    script: investigation((ev) => ev.type === "complete" || ev.type === "run:aborted"),
  });
  assert.equal(run.halted, true);
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  assert.deepEqual(annexures(dir), ["annexure-1.md", "annexure-2.md"], "each annexure was filed as its report returned");
  assert.match(fs.readFileSync(path.join(dir, "annexure-2.md"), "utf8"), /SECOND-FINDING/);
  const record = asBriefRecord(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  assert.ok(record, "the folder holds a record of what the run had");
  assert.equal(record.unsettled, "failed");
  assert.deepEqual(record.inquiries.filter((i) => i.findings).map((i) => i.findings), ["FIRST-FINDING", "SECOND-FINDING"]);
  assert.ok(record.answer.includes("FIRST-FINDING") && record.answer.includes("SECOND-FINDING"), "the findings as written are what a reopen shows");
});

test("a settling pass whose decode fails for room ends the run unsettled, with every finding, as a refused one does", async () => {
  const run = await runHarness({
    config: threeTasksAllowed,
    utterances: threeStages,
    // The settling agent's commit of its answer finds no room: rc 1, the branch intact — the pool's commit give-way.
    instrument: (c) => {
      c.mockCommitError = (_handles, tokens) =>
        tokens.some((t) => c.tokenToText(t) === "the settled brief") ? { message: "llama_decode failed: no KV slot", rc: 1, partial: false } : null;
    },
    script: investigation((ev) => ev.type === "complete" || ev.type === "run:aborted"),
  });
  const answer = run.events.find((e) => e.type === "answer") as { text: string | null; unsettled?: string } | undefined;
  assert.ok(answer?.text?.includes("FIRST-FINDING") && answer.text.includes("SECOND-FINDING") && answer.text.includes("THIRD-FINDING"),
    `every finding is the answer: ${JSON.stringify(answer)} after ${run.events.map((e) => e.type).join(" ")}`);
  assert.equal(answer?.unsettled, "no_room", "the answer says there was no room to settle them");
  assert.ok(run.events.some((e) => e.type === "complete"));
  assert.ok(!run.events.some((e) => e.type === "run:aborted"));
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  assert.deepEqual(annexures(dir), ["annexure-1.md", "annexure-2.md", "annexure-3.md"]);
  assert.equal(asBriefRecord(fs.readFileSync(path.join(dir, "report.json"), "utf8"))?.unsettled, "no_room");
  // What the settling pass cost is kept with the brief, answer or no answer.
  const done = run.events.find((e) => e.type === "synthesize:done") as { tokenCount: number } | undefined;
  const complete = run.events.find((e) => e.type === "complete") as { data: { synthTokens: number } } | undefined;
  assert.ok(done && done.tokenCount > 0, "the settling pass sampled tokens before its commit found no room");
  assert.equal(complete?.data.synthTokens, done.tokenCount, "the settling pass's cost is on the record");
});

test("a run stopped after two of three stages ends as an unsettled brief: the canvas and the disk agree, and the next ask is an exchange beneath it", async () => {
  let spawns = 0;
  const run = await runHarness({
    config: threeTasksAllowed,
    // The third stage's words and the follow-up's are both plain text: whichever of them the stop leaves
    // unspoken, the follow-up answers in prose.
    utterances: [...threeStages.slice(0, 3), { text: "THIRD-STAGE-TEXT", kind: "text" }, { text: "the follow-up answer", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "deep" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      // The third stage has just been seated when the reader stops: two reports are filed, the third never written.
      { on: (ev) => ev.type === "agent:spawn" && ++spawns === 3, send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted", send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const types = run.events.map((e) => e.type);
  const answerAt = types.indexOf("answer");
  const abortedAt = types.indexOf("run:aborted");
  assert.ok(answerAt >= 0 && answerAt < abortedAt, `the stopped run said its answer before the stop was marked: ${types.join(" ")}`);
  const answer = run.events[answerAt] as { text: string | null; unsettled?: string };
  assert.ok(answer.text?.includes("FIRST-FINDING") && answer.text.includes("SECOND-FINDING") && !answer.text.includes("THIRD"), answer.text ?? "");
  assert.equal(answer.unsettled, "failed", "a stopped run's findings are an answer that was not settled");
  assert.deepEqual(run.events[abortedAt], { type: "run:aborted", stopped: true });

  // The canvas at the stop: the brief holds its answer and the run bar reads Incomplete.
  const docId = docIdOfQuery(run.events);
  const atStop = run.events.slice(0, abortedAt + 1).reduce(reduce, initialState);
  assert.equal(atStop.documents.get(docId)!.unsettled, "failed");
  assert.equal(selectStatus(atStop), "Incomplete");

  // The follow-up: an exchange beneath the brief on the canvas, and on disk.
  const s = run.events.reduce(reduce, initialState);
  const doc = s.documents.get(docId)!;
  assert.ok(doc.answer?.includes("FIRST-FINDING"), "the root answer stands");
  assert.equal(doc.exchanges.length, 1, "the follow-up is an exchange beneath it, not a new root");
  const dir = path.join(run.outputDir, docId);
  // The stopped run's two annexures stand; the follow-up's own finding is filed after them, as an exchange's is.
  assert.deepEqual(annexures(dir), ["annexure-1.md", "annexure-2.md", "annexure-3.md"]);
  assert.ok(fs.existsSync(path.join(dir, "exchange-1.json")), "the follow-up is an exchange on disk too");
  assert.equal(asBriefRecord(fs.readFileSync(path.join(dir, "report.json"), "utf8"))?.unsettled, "failed");
});

/** The same expectations the stop has, for any way a run with filed findings ends: the answer said before the end
 *  is marked, the canvas and the disk agreeing on the next ask. */
function endedAsTheDiskHolds(run: Awaited<ReturnType<typeof runHarness>>, endMark: (ev: WorkflowEvent) => boolean, filed: string[]): { text: string } {
  const types = run.events.map((e) => e.type);
  const answerAt = types.indexOf("answer");
  const endAt = run.events.findIndex(endMark);
  assert.ok(answerAt >= 0 && answerAt < endAt, `the run said its answer before its end was marked: ${types.join(" ")}`);
  const answer = run.events[answerAt] as { text: string | null; unsettled?: string };
  assert.ok(answer.text?.includes("FIRST-FINDING") && answer.text.includes("SECOND-FINDING"), answer.text ?? "");
  assert.equal(answer.unsettled, "failed");
  const docId = docIdOfQuery(run.events);
  const s = run.events.reduce(reduce, initialState);
  const doc = s.documents.get(docId)!;
  assert.ok(doc.answer?.includes("FIRST-FINDING"), "the root answer stands on the canvas");
  assert.equal(doc.exchanges.length, 1, "the follow-up is an exchange beneath it, not a new root");
  const dir = path.join(run.outputDir, docId);
  assert.deepEqual(annexures(dir), filed);
  assert.ok(fs.existsSync(path.join(dir, "exchange-1.json")), "the follow-up is an exchange on disk too");
  assert.equal(asBriefRecord(fs.readFileSync(path.join(dir, "report.json"), "utf8"))?.unsettled, "failed");
  return { text: answer.text! };
}

test("a run whose answer the trunk would not take ends as the brief the disk holds: the findings as written, and the next ask is an exchange", async () => {
  let armed = false;
  const run = await runHarness({
    config: threeTasksAllowed,
    utterances: [...threeStages, { text: "the follow-up answer", kind: "text" }],
    instrument: (c) => {
      // After the settling pass, the one single-handle prefill is the answer's commit onto the trunk.
      const inner = c._storePrefill.bind(c);
      c._storePrefill = async (handles, tokenArrays) => {
        if (armed && handles.length === 1) { armed = false; throw new Error("the trunk would not take the answer"); }
        return inner(handles, tokenArrays);
      };
    },
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "deep" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      // The toast is the failed run's last word; the next ask comes after it, as a reader's would.
      { on: (ev) => { if (ev.type === "synthesize:done") armed = true; return ev.type === "ui:error"; },
        send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const told = run.events.find((e) => e.type === "ui:error") as { message: string } | undefined;
  assert.ok(told?.message.includes("the trunk would not take the answer"), `the reader is told why: ${run.events.map((e) => e.type).join(" ")}`);
  // Every stage had finished, so the findings as written hold all three; the settled brief the trunk did not take is
  // not published as if it had been.
  const { text } = endedAsTheDiskHolds(run, (ev) => ev.type === "run:aborted", ["annexure-1.md", "annexure-2.md", "annexure-3.md", "annexure-4.md"]);
  assert.ok(text.includes("THIRD-FINDING") && !text.includes("the settled brief"), text);
});

test("a run replaced by a direct ask into the same brief ends as the brief the disk holds, and the ask is an exchange beneath it", async () => {
  let spawns = 0;
  const run = await runHarness({
    config: threeTasksAllowed,
    utterances: [...threeStages.slice(0, 3), { text: "THIRD-STAGE-TEXT", kind: "text" }, { text: "the follow-up answer", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "deep" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      // The reader asks into the brief while its third stage is seated: the new ask replaces the run.
      { on: (ev) => ev.type === "agent:spawn" && ++spawns === 3, send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1);
  const { text } = endedAsTheDiskHolds(run, (ev) => ev.type === "run:aborted", ["annexure-1.md", "annexure-2.md", "annexure-3.md"]);
  assert.ok(!text.includes("THIRD"), text);
});
