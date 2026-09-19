/**
 * Every native step of an ask runs under the run, where Stop can reach it, and
 * a halt waits for the call in flight before anything else touches the model.
 * Each scenario stops — or replaces — from INSIDE an instrumented native call,
 * where a real Stop lands, and reads what the trunk holds afterwards off the
 * trace. The laws: a stop during a brief's restoration, then the same ask,
 * restores the thread whole; a stop during the planner, then an ask into the
 * same canvas, writes the brief's first report; a stop after the user side of
 * an image ask, then a text-only question, commits the answer under the new
 * question with the abandoned side gone; a stop during `commitAnswer` leaves
 * the landed pair unpublished and the next ask rebuilds from the library; a
 * replacement during a prefill starts only once the prefill has landed; with A
 * running, B opened and A reopened, an ask into A carries nothing of B.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileAttachmentStore } from "@lloyal-labs/media/node";
import type { Attachment } from "@lloyal-labs/media";
import type { MockSessionContext } from "@lloyal-labs/sdk/testing";
import { runHarness, warmDeltas, sessionReleasesOf, docIdOfQuery, writeReportFixture, accept } from "./harness.js";
import type { Command } from "../../src/brief/protocol.js";

const PLAN_JSON = JSON.stringify({ intent: "research", tasks: [{ description: "investigate the topic" }], clarifyQuestions: [] });
const A = "2026-01-01T00-00-00-000";
const B = "2026-01-02T00-00-00-000";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Hold the next trunk prefill once `armed()` says so: fire `command` from inside it, let the halt find the call in
 *  flight, then let the call land. Records the order of landings and prunes, so a scenario can see the halt wait. */
function holdTrunkPrefill(ctx: MockSessionContext, armed: () => boolean, fire: () => void, order: string[]): void {
  const inner = ctx._storePrefill.bind(ctx);
  let held = false;
  ctx._storePrefill = async (handles, tokenArrays) => {
    if (!held && armed() && handles.length === 1) {
      held = true;
      await new Promise<void>((r) => setImmediate(r));   // the fiber reaches its barrier, where a real Stop finds it
      fire();
      await new Promise<void>((r) => setTimeout(r, 15));
      const out = await inner(handles, tokenArrays);
      order.push("prefill:landed");
      return out;
    }
    return inner(handles, tokenArrays);
  };
  const prune = ctx._branchPrune.bind(ctx);
  ctx._branchPrune = (h) => { order.push("prune"); return prune(h); };
}

test("a stop during A's restoration, then the same ask: A's thread is restored whole, on a fresh trunk", async () => {
  let armed = false;
  let send!: (c: Command) => void;
  const order: string[] = [];
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, A, "Saved brief", "The saved body."),
    utterances: [{ text: "Warm answer.", kind: "text" }],
    controls: (c) => { send = c.send; },
    instrument: (ctx) => holdTrunkPrefill(ctx, () => armed, () => send({ type: "stop" }), order),
    script: [
      { send: { type: "open_doc", docId: A } },
      { on: (ev) => ev.type === "doc:active", send: { type: "submit_query", query: "A follow-up?", mode: "flat", skipPlanner: true } },
      { on: (ev) => { if (ev.type === "query") armed = true; return ev.type === "run:aborted"; },
        send: { type: "submit_query", query: "A follow-up?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const deltas = warmDeltas(run.trace);
  assert.deepEqual(deltas.map((d) => d.speaker), ["turn", "turn", "turn"], "the halted restore landed; the ask restored again, then settled");
  assert.ok(deltas[0].content?.includes("The saved body.") && deltas[1].content?.includes("The saved body."), "the thread, whole, both times");
  assert.ok(deltas[2].content?.includes("Warm answer."));
  assert.notEqual(deltas[1].branchHandle, deltas[0].branchHandle, "the second ask rebuilt the trunk");
  assert.equal(deltas[2].branchHandle, deltas[1].branchHandle);
  assert.equal(sessionReleasesOf(run, deltas[0].branchHandle!).length, 1, "the halted restore's trunk was released once");
  assert.equal(order.indexOf("prefill:landed"), 0, "nothing was pruned until the held prefill had landed");
  const exchanges = fs.readdirSync(path.join(run.outputDir, A)).filter((f) => /^exchange-\d+\.md$/.test(f));
  assert.equal(exchanges.length, 1);
});

test("a stop during the planner, then an ask into the same canvas: the brief's first report lands in its folder", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text", stallTokens: 400 },
      { text: "The direct answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "A?", mode: "flat" } },
      { on: (ev) => ev.type === "plan:start", send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted", send: { type: "submit_query", query: "A, directly?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const a = docIdOfQuery(run.events, 0);
  assert.equal(docIdOfQuery(run.events, 1), a, "the same brief");
  assert.equal(run.events.filter((e) => e.type === "plan").length, 1, "the stopped planner never planned; the ask is its own plan");
  assert.ok(fs.existsSync(path.join(run.outputDir, a, "report.md")), "its first report, in its folder");
  assert.equal(warmDeltas(run.trace).length, 1);
});

test("a stop after the user side of an image ask, then a text-only question: the answer is committed under the new question, the abandoned side gone", async () => {
  const store = new FileAttachmentStore(fs.mkdtempSync(path.join(os.tmpdir(), "steps-scn-")));
  const image: Attachment = store.putAttachment({ representations: [store.putBlob(PNG, "image/png")] });
  let send!: (c: Command) => void;
  const run = await runHarness({
    attachmentStore: store,
    utterances: [{ text: "About the text.", kind: "text" }],
    controls: (c) => { send = c.send; },
    instrument: (ctx) => {
      const inner = ctx._storePrefillMultimodal.bind(ctx);
      let held = false;
      ctx._storePrefillMultimodal = async (...args: Parameters<typeof inner>) => {
        if (!held) {
          held = true;
          await new Promise<void>((r) => setImmediate(r));
          send({ type: "stop" });
          await new Promise<void>((r) => setTimeout(r, 15));
        }
        return inner(...args);
      };
    },
    script: [
      { send: { type: "submit_query", query: "What is in the picture?", mode: "flat", skipPlanner: true, attachments: [image] } },
      { on: (ev) => ev.type === "run:aborted", send: { type: "submit_query", query: "Just the text, then?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const deltas = warmDeltas(run.trace);
  assert.deepEqual(deltas.map((d) => d.speaker), ["user", "turn"], "the abandoned side was the reader's alone; then one pair, committed whole");
  assert.ok(deltas[1].content?.includes("Just the text, then?") && deltas[1].content?.includes("About the text."));
  assert.ok(!deltas[1].content?.includes("What is in the picture?"), "nothing of the abandoned ask in the new pair");
  assert.notEqual(deltas[1].branchHandle, deltas[0].branchHandle, "the trunk was rebuilt");
  assert.equal(sessionReleasesOf(run, deltas[0].branchHandle!).length, 1, "the trunk with the dangling side was released");
  assert.equal(docIdOfQuery(run.events, 1), docIdOfQuery(run.events, 0), "into the same brief");
});

test("a stop during commitAnswer leaves the landed pair unpublished; the next ask into that brief rebuilds from the library", async () => {
  let armed = false;
  let send!: (c: Command) => void;
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, A, "Saved brief", "The saved body."),
    utterances: [{ text: "Second answer.", kind: "text" }, { text: "Third answer.", kind: "text" }],
    controls: (c) => { send = c.send; },
    instrument: (ctx) => holdTrunkPrefill(ctx, () => armed, () => send({ type: "stop" }), []),
    script: [
      { send: { type: "open_doc", docId: A } },
      { on: (ev) => ev.type === "doc:active", send: { type: "submit_query", query: "Q2?", mode: "flat", skipPlanner: true } },
      { on: (ev) => { if (ev.type === "research:done") armed = true; return ev.type === "run:aborted"; },
        send: { type: "submit_query", query: "Q3?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "answer").length, 1, "the stopped ask's answer was never said");
  const deltas = warmDeltas(run.trace);
  assert.deepEqual(deltas.map((d) => d.content?.includes("Second answer.") ? "Q2" : d.content?.includes("Third answer.") ? "Q3" : "thread"),
    ["thread", "Q2", "thread", "Q3"], "the pair landed under the stop; the next ask rebuilt from the library and settled");
  assert.notEqual(deltas[2].branchHandle, deltas[1].branchHandle);
  assert.equal(sessionReleasesOf(run, deltas[1].branchHandle!).length, 1, "the trunk holding the unpublished pair was released");
  const dir = path.join(run.outputDir, A);
  const exchanges = fs.readdirSync(dir).filter((f) => /^exchange-\d+\.md$/.test(f));
  assert.equal(exchanges.length, 1, "one exchange: the reader never met the unpublished answer");
  assert.ok(fs.readFileSync(path.join(dir, exchanges[0]), "utf8").includes("Third answer."));
});

test("a replacement during a prefill: the halt waits for the prefill to land, then the new brief runs", async () => {
  let armed = false;
  let send!: (c: Command) => void;
  const order: string[] = [];
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, A, "Saved brief", "The saved body."),
    utterances: [{ text: PLAN_JSON, kind: "text" }, { text: "B's findings", kind: "report" }],
    controls: (c) => { send = c.send; },
    instrument: (ctx) => holdTrunkPrefill(ctx, () => armed, () => send({ type: "submit_query", query: "B?", mode: "flat" }), order),
    script: [
      { send: { type: "open_doc", docId: A } },
      { on: (ev) => ev.type === "doc:active", send: { type: "submit_query", query: "A follow-up?", mode: "flat", skipPlanner: true } },
      { on: (ev) => { if (ev.type === "query") armed = true; return ev.type === "ui:plan_review"; }, send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const types = run.events.map((e) => e.type);
  assert.ok(types.indexOf("run:aborted") < types.lastIndexOf("query"), "A's end was announced before B's echo");
  assert.equal(order.indexOf("prefill:landed"), 0, "A's restore landed before anything was pruned for B");
  const deltas = warmDeltas(run.trace);
  assert.equal(deltas.length, 2, "A's halted restore, then B's settle");
  assert.notEqual(deltas[1].branchHandle, deltas[0].branchHandle);
  assert.equal(sessionReleasesOf(run, deltas[0].branchHandle!).length, 1);
  const b = docIdOfQuery(run.events, 1);
  assert.notEqual(b, A);
  assert.ok(fs.existsSync(path.join(run.outputDir, b, "report.md")));
});

test("A running, B opened, A reopened, an ask into A: nothing of B reaches A's trunk", async () => {
  let aId: string | null = null;
  const run = await runHarness({
    setup: (dir) => writeReportFixture(dir, B, "Doc B", "B's settled body."),
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: "never finishes", kind: "report", stallTokens: 2000 },
      { text: "A's direct answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "A?", mode: "flat" } },
      { on: (ev) => { if (ev.type === "query" && aId === null) aId = ev.docId; return ev.type === "ui:plan_review"; }, send: accept },
      { on: (ev) => ev.type === "research:start" },
      { on: (ev) => ev.type === "agent:produce", send: { type: "open_doc", docId: B } },   // A's inquiry is under way
      { on: (ev) => ev.type === "doc:active" && ev.docId === B, send: () => ({ type: "open_doc", docId: aId }) },
      { on: (ev) => ev.type === "doc:active" && ev.docId === aId,
        send: { type: "submit_query", query: "A, directly?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const a = docIdOfQuery(run.events, 0);
  assert.equal(docIdOfQuery(run.events, 1), a, "the ask went into A");
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1, "A's first run was abandoned by the ask");
  const deltas = warmDeltas(run.trace);
  assert.equal(deltas.length, 1, "one commit: A's pair");
  assert.ok(deltas[0].content?.includes("A's direct answer.") && !deltas[0].content?.includes("B's settled body"));
  assert.ok(fs.existsSync(path.join(run.outputDir, a, "report.md")), "A's first report");
  assert.ok(fs.readFileSync(path.join(run.outputDir, B, "report.md"), "utf8").includes("B's settled body."), "B untouched");
});
