/**
 * The one-shot path: the harness awaits the accepted run's own future, so an
 * ordinary planner or writer failure says `ui:error` and is the harness's
 * exit; a planner that must ask is `HarnessExit` 2; no query is `HarnessExit`
 * 2; a healthy run settles and the harness returns on its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { HarnessExit } from "../../src/brief/protocol.js";
import { runHarness, docIdOfQuery } from "./harness.js";

const PLAN_JSON = JSON.stringify({ intent: "research", tasks: [{ description: "investigate the topic" }], clarifyQuestions: [] });
const CLARIFY_JSON = JSON.stringify({ intent: "clarify", tasks: [], clarifyQuestions: ["Which one?"] });

test("a healthy one-shot settles the brief and returns", async () => {
  const run = await runHarness({
    oneshot: "Q?",
    utterances: [{ text: PLAN_JSON, kind: "text" }, { text: "findings", kind: "report" }],
    script: [{ on: () => false }],
  });
  assert.equal(run.failure, undefined);
  assert.equal(run.events.filter((e) => e.type === "ui:plan_review").length, 0, "no reader, no review");
  assert.ok(fs.existsSync(path.join(run.outputDir, docIdOfQuery(run.events), "report.md")));
});

test("an ordinary planner failure in one-shot mode says ui:error and is the harness's exit", async () => {
  const run = await runHarness({
    oneshot: "Q?",
    utterances: [{ text: PLAN_JSON, kind: "text" }],
    instrument: (ctx) => {
      const inner = ctx._storePrefill.bind(ctx);
      let first = true;
      ctx._storePrefill = async (h, t) => {
        if (first) { first = false; throw new Error("the planner's prefill failed"); }
        return inner(h, t);
      };
    },
    script: [{ on: () => false }],
  });
  assert.ok(run.failure instanceof Error && /planner's prefill failed/.test(run.failure.message), "the run's failure is the harness's");
  assert.equal(run.failure instanceof HarnessExit, false, "an ordinary failure, not a verdict of the harness's own");
  const toast = run.events.find((e) => e.type === "ui:error") as { message: string } | undefined;
  assert.match(toast?.message ?? "", /planner's prefill failed/);
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1);
  assert.equal(fs.readdirSync(run.outputDir).length, 0, "nothing settled, nothing reserved");
});

test("a planner that must ask, with no one to answer, is HarnessExit 2", async () => {
  const run = await runHarness({
    oneshot: "Q?",
    utterances: [{ text: CLARIFY_JSON, kind: "text" }],
    script: [{ on: () => false }],
  });
  assert.ok(run.failure instanceof HarnessExit);
  assert.equal(run.failure.exitCode, 2);
  assert.equal(run.events.filter((e) => e.type === "ui:clarify").length, 0, "no round was armed");
});

test("one-shot with no query is HarnessExit 2", async () => {
  const run = await runHarness({ oneshot: "", script: [{ on: () => false }] });
  assert.ok(run.failure instanceof HarnessExit);
  assert.equal(run.failure.exitCode, 2);
});
