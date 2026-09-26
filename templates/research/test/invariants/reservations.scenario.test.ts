/**
 * A document's identity is reserved before anything uses it, and the
 * reservation lives exactly as long as the document is unfinished.
 *
 * The identity is a timestamp plus a UUID; the directory under the library is
 * created — exclusively — when the identity is minted, so two sessions cannot
 * name one document and a collision retries or refuses before the trunk or the
 * wire carries the id. What the caller knows decides the run dir's meaning: a
 * new document writes its own, a follow-up threads beside a settled report or
 * writes the first report of a document still awaiting its plan. Abandonment,
 * failure, a rejected submit, quit and disconnect release what never settled;
 * a settled report is never touched (the 2026-09-12 release review, R9).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runHarness, docIdOfQuery, writeReportFixture, accept, answer, dirs,
} from "./harness.js";
import type { WorkflowEvent } from "../../src/protocol.js";

const PLAN_JSON = JSON.stringify({ intent: "research", tasks: [{ description: "investigate the topic" }], clarifyQuestions: [] });
const CLARIFY_JSON = JSON.stringify({ intent: "clarify", tasks: [], clarifyQuestions: ["Which one?"] });
const report = { text: "Findings: alpha.", kind: "report" as const };
const plan = { text: PLAN_JSON, kind: "text" as const };
const ask = (query: string) => ({ type: "submit_query", query, mode: "flat", skipPlanner: true }) as const;
const submit = (query: string) => ({ type: "submit_query", query, mode: "flat" }) as const;
const files = (outputDir: string, docId: string): string[] => fs.readdirSync(path.join(outputDir, docId)).sort();

/** Pin the clock so the timestamp half of the next mint is known. */
const FROZEN = new Date("2026-03-01T12:00:00.000Z");
const STAMP = FROZEN.toISOString().replace(/[:.]/g, "-").replace("Z", "");
const DUP = "0f0f0f0f-0000-4000-8000-00000000dead";
const FRESH = "0f0f0f0f-0000-4000-8000-0000000f0e5";

test("a collision on mint retries with a fresh identity: the planted document is untouched", async () => {
  mock.timers.enable({ apis: ["Date"], now: FROZEN });
  const uuids = [DUP, FRESH];
  const real = webcrypto.randomUUID.bind(webcrypto);
  mock.method(webcrypto, "randomUUID", () => uuids.shift() ?? real());
  try {
    const planted = `${STAMP}-${DUP}`;
    const run = await runHarness({
      setup: (dir) => writeReportFixture(dir, planted, "Planted", "The planted body."),
      utterances: [report],
      script: [{ send: ask("Q?") }, { on: (ev) => ev.type === "complete" }],
    });
    const minted = docIdOfQuery(run.events);
    assert.equal(minted, `${STAMP}-${FRESH}`, "the second identity was taken");
    assert.equal(fs.readFileSync(path.join(run.outputDir, planted, "report.md"), "utf8").includes("The planted body."), true);
    assert.deepEqual(files(run.outputDir, planted), ["report.json", "report.md"], "nothing threaded onto the planted document");
    assert.ok(fs.existsSync(path.join(run.outputDir, minted, "report.md")), "the new document settled in its own reservation");
    assert.equal(run.events.filter((e) => e.type === "ui:error").length, 0);
  } finally {
    mock.timers.reset();
    mock.restoreAll();
  }
});

test("a mint that cannot reserve refuses the submit with nothing changed: no echo, no trunk, the parked plan still there", async () => {
  mock.timers.enable({ apis: ["Date"], now: FROZEN });
  let collide = false;
  const real = webcrypto.randomUUID.bind(webcrypto);
  mock.method(webcrypto, "randomUUID", () => (collide ? DUP : real()));
  try {
    const planted = `${STAMP}-${DUP}`;
    let errors = 0;
    const run = await runHarness({
      setup: (dir) => writeReportFixture(dir, planted, "Planted", "The planted body."),
      utterances: [plan, report],
      script: [
        { send: submit("A?") },
        // The plan parks; now every mint collides, and a NEW document is asked for.
        { on: (ev) => { if (ev.type === "ui:plan_review") { collide = true; return true; } return false; }, send: submit("B?") },
        { on: (ev) => { if (ev.type === "ui:error") errors++; return ev.type === "ui:error"; }, send: () => { collide = false; return accept(); } },
        { on: (ev) => ev.type === "complete" },
      ],
    });
    const queries = run.events.filter((e) => e.type === "query") as { docId: string }[];
    assert.equal(queries.length, 1, "the refused submit echoed nothing");
    assert.equal(errors, 1);
    assert.match((run.events.find((e) => e.type === "ui:error") as { message: string }).message, /Couldn't start a new document/);
    assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 0, "the parked plan was not abandoned");
    assert.ok(fs.existsSync(path.join(run.outputDir, queries[0].docId, "report.md")), "the accepted plan ran to a report");
    assert.deepEqual(dirs(run.outputDir), [planted, queries[0].docId].sort(), "no stray reservation");
  } finally {
    mock.timers.reset();
    mock.restoreAll();
  }
});

test("an ask while the plan is parked writes the document's FIRST report into its reservation", async () => {
  const run = await runHarness({
    utterances: [plan, report],
    script: [
      { send: submit("A?") },
      { on: (ev) => ev.type === "ui:plan_review", send: ask("just answer A") },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const a = docIdOfQuery(run.events, 0);
  assert.equal(docIdOfQuery(run.events, 1), a, "the ask continued the parked document");
  assert.equal(run.events.filter((e) => e.type === "ui:error").length, 0, "no error toast");
  const written = files(run.outputDir, a);
  assert.ok(written.includes("report.md"), "the ask wrote the document's first report");
  assert.deepEqual(written.filter((f) => f.startsWith("exchange-")), [], "a first report, not a thread");
  assert.deepEqual(dirs(run.outputDir), [a]);
});

test("a follow-up on a settled document threads beside its report", async () => {
  const saved = "2026-01-01T00-00-00-000";
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, saved, "Saved brief", "The saved body."),
    utterances: [report],
    script: [
      { send: { type: "open_doc", docId: saved } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === saved, send: ask("and then?") },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const written = files(run.outputDir, saved);
  assert.deepEqual(written.filter((f) => !f.startsWith("annexure-")), ["exchange-1.json", "exchange-1.md", "report.json", "report.md"], "one exchange beside the one report");
  assert.equal(fs.readFileSync(path.join(run.outputDir, saved, "report.md"), "utf8").includes("The saved body."), true, "the report is untouched");
});

test("a submit over a live run: the abandoned run's end never reaches the new document's sink", async () => {
  // The sink reads the wire behind the handler, so an abort taken off the wire ends whichever run the
  // handler has started since — leaving the new document to settle with no report on disk.
  const run = await runHarness({
    utterances: [plan, { text: "never finishes", kind: "report", stallTokens: 2000 }, plan, report],
    script: [
      { send: submit("A?") },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "agent:produce", send: submit("B?") },
      { on: (ev) => ev.type === "run:aborted" },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const a = docIdOfQuery(run.events, 0);
  const b = docIdOfQuery(run.events, 1);
  assert.equal(fs.existsSync(path.join(run.outputDir, a)), false, "A's stillborn directory was released");
  assert.ok(fs.existsSync(path.join(run.outputDir, b, "report.md")), "B settled with its report on disk");
});

test("a parked plan abandoned by new_run leaves no directory; a rejected attachment aborts nothing and reserves nothing", async () => {
  const bad = { digest: "not-a-digest", mediaType: "image/png", size: 1 };
  const run = await runHarness({
    utterances: [plan, plan, { text: "slow findings", kind: "report", stallTokens: 40 }],
    script: [
      { send: submit("A?") },
      { on: (ev) => ev.type === "ui:plan_review", send: { type: "new_run" } },
      { on: (ev) => ev.type === "run:aborted", send: submit("B?") },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "research:start", send: { type: "submit_query", query: "C?", mode: "flat", attachments: [bad] } as unknown as WorkflowEvent as never },
      { on: (ev) => ev.type === "ui:error" },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const a = docIdOfQuery(run.events, 0);
  const b = docIdOfQuery(run.events, 1);
  assert.equal(fs.existsSync(path.join(run.outputDir, a)), false, "the abandoned plan's reservation was released");
  assert.equal(run.events.filter((e) => e.type === "query").length, 2, "the rejected submit echoed nothing");
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1, "the rejection aborted nothing: only new_run did");
  assert.match((run.events.find((e) => e.type === "ui:error") as { message: string }).message, /attachment/);
  assert.ok(fs.existsSync(path.join(run.outputDir, b, "report.md")), "B ran to its report");
  assert.deepEqual(dirs(run.outputDir), [b], "no reservation for the rejected submit");
});

test("quit while a plan is parked releases the reservation", async () => {
  const run = await runHarness({
    utterances: [plan],
    script: [{ send: submit("A?") }, { on: (ev) => ev.type === "ui:plan_review" }],
  });
  const a = docIdOfQuery(run.events);
  assert.equal(fs.existsSync(path.join(run.outputDir, a)), false, "teardown released the parked document's reservation");
  assert.deepEqual(dirs(run.outputDir), []);
});

test("a run that dies releases its reservation and announces the death", async () => {
  // The planner asks to clarify; the round joins the trunk as it is answered,
  // and that commit fails. Armed by the clarify plan on the wire, so the
  // pool's own prefills before it are untouched.
  let armed = false;
  const run = await runHarness({
    utterances: [{ text: CLARIFY_JSON, kind: "text" }],
    instrument: (ctx) => {
      const inner = ctx._storePrefill.bind(ctx);
      ctx._storePrefill = async (handles, tokenArrays) => {
        if (armed && handles.length === 1) { armed = false; throw new Error("the trunk commit failed"); }
        return inner(handles, tokenArrays);
      };
    },
    script: [
      { send: submit("A?") },
      { on: (ev) => { if (ev.type === "plan" && (ev as { intent?: string }).intent === "clarify") armed = true; return ev.type === "ui:clarify"; }, send: answer("This one.") },
      { on: (ev) => ev.type === "run:aborted" },
      { on: (ev) => ev.type === "ui:error" },
    ],
  });
  const a = docIdOfQuery(run.events);
  assert.match((run.events.find((e) => e.type === "ui:error") as { message: string }).message, /trunk commit failed/);
  assert.equal(fs.existsSync(path.join(run.outputDir, a)), false, "the dead run's reservation was released");
});
