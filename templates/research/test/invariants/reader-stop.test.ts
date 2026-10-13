/**
 * The reader stops a brief. The run is abandoned, but what it wrote stays on the canvas: a section mid-report
 * keeps its text under a rule saying the reader stopped it, a section mid-search says so with nothing kept,
 * and the brief reads as stopped, not writing. Any other abort leaves no half-written document behind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent } from "../../src/protocol.js";
import { selectLive, selectSections, selectStatus } from "../../src/ui/select.js";

const fold = (events: WorkflowEvent[], from: AppState = initialState): AppState => events.reduce(reduce, from);
const A = "2026-10-13T10-00-00-000";
const KEPT = "## Findings\n\nThe safety bicycle's chain drive moved the rider";
const envelope = (body: string): string => `<tool_call>\n<function=report>\n<parameter=result>\n${body}`;

/** A brief under A, mid-research: task 0 writing its report, task 1 between searches, no task 2 seated yet. */
const writing = (): AppState =>
  fold([
    { type: "query", docId: A, query: "Q", warm: false } as WorkflowEvent,
    { type: "plan:start", query: "Q", mode: "flat" } as WorkflowEvent,
    { type: "plan", intent: "research", tasks: [{ description: "a" }, { description: "b" }, { description: "c" }], clarifyQuestions: [], tokenCount: 1, timeMs: 1 } as WorkflowEvent,
    { type: "research:start", agentCount: 3, mode: "flat" } as WorkflowEvent,
    { type: "agent:spawn", agentId: 10, key: "task:0" } as WorkflowEvent,
    { type: "agent:spawn", agentId: 11, key: "task:1" } as WorkflowEvent,
    { type: "agent:produce", agentId: 10, text: "x</think>", tokenCount: 1 } as WorkflowEvent,
    { type: "agent:produce", agentId: 10, text: envelope(KEPT), tokenCount: 40 } as WorkflowEvent,
    { type: "agent:produce", agentId: 11, text: '<tool_call>{"name":"web_search"', tokenCount: 5 } as WorkflowEvent,
  ]);

test("a stopped brief stays on the canvas, as written, and no longer runs", () => {
  const s = fold([{ type: "run:aborted", stopped: true } as WorkflowEvent], writing());
  const doc = s.documents.get(A);
  assert.ok(doc, "the document is kept");
  assert.equal(doc.stopped, true);
  assert.equal(s.runDocId, null);
  assert.equal(s.activeDocId, A);
  assert.equal(selectLive(s), false);
  assert.equal(selectStatus(s), "Stopped");
});

test("a section mid-report keeps its text under the reader's rule; one mid-search says it stopped with nothing kept", () => {
  const sections = selectSections(fold([{ type: "run:aborted", stopped: true } as WorkflowEvent], writing()));
  assert.equal(sections[0].prose, KEPT);
  assert.equal(sections[0].streaming, false);
  assert.deepEqual(sections[0].stopped, { note: "stopped by you — kept to here", tail: null });
  assert.deepEqual(sections[0].inquiry?.verb, { kind: "kept", text: "stopped by you — kept to here" });
  assert.equal(sections[1].prose, null);
  assert.deepEqual(sections[1].inquiry?.verb, { kind: "kept", text: "stopped by you" });
  assert.equal(sections[2].inquiry, null);
  assert.equal(sections[2].waiting, false, "a task the stop left unseated waits for nothing");
});

test("an abort the reader did not ask for leaves no half-written brief", () => {
  const s = fold([{ type: "run:aborted" } as WorkflowEvent], writing());
  assert.equal(s.documents.has(A), false);
  assert.equal(s.runDocId, null);
});

test("a stop before anything was written leaves nothing to keep", () => {
  const s = fold([
    { type: "query", docId: A, query: "Q", warm: false } as WorkflowEvent,
    { type: "plan:start", query: "Q", mode: "flat" } as WorkflowEvent,
    { type: "run:aborted", stopped: true } as WorkflowEvent,
  ]);
  assert.equal(s.documents.has(A), false);
});
