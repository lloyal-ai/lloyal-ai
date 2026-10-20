/**
 * A dropped inquiry's recovery is written in the open. The recovery report arrives as one event at the end of
 * the recovery, up to a minute after the drop; until then the section must say what is happening — the agent
 * is recovering what it found — not that it is settling prose nothing has streamed. The state is keyed off the
 * event that already marks the agent dropped, and ends when its recovery lands. A section that settled on its
 * own terms is untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent } from "../../src/protocol.js";
import { selectSections } from "../../src/ui/select.js";

const A = "2026-09-02T10-00-00-000";
const fold = (events: WorkflowEvent[], from: AppState = initialState): AppState => events.reduce(reduce, from);

/** Two inquiries at work on a flat plan: agent 1 on task 0, agent 2 on task 1. */
const working = (): AppState => fold([
  { type: "query", docId: A, query: "Q?", warm: false } as WorkflowEvent,
  { type: "plan:start", query: "Q?", mode: "flat" } as WorkflowEvent,
  { type: "plan", intent: "research", tasks: [{ description: "a" }, { description: "b" }], clarifyQuestions: [], tokenCount: 1, timeMs: 1 } as WorkflowEvent,
  { type: "research:start", agentCount: 2, mode: "flat" } as WorkflowEvent,
  { type: "agent:spawn", agentId: 1, parentAgentId: 0, key: "task:0" } as WorkflowEvent,
  { type: "agent:spawn", agentId: 2, parentAgentId: 0, key: "task:1" } as WorkflowEvent,
]);

const verbOf = (s: AppState, index: number): { kind: string; text: string } => {
  const inquiry = selectSections(s)[index].inquiry;
  assert.ok(inquiry, `section ${index} has an inquiry`);
  return inquiry.verb;
};

test("a dropped inquiry says it is recovering what it found until its recovery lands", () => {
  let s = fold([{ type: "agent:done", agentId: 1, reason: "pressure_critical" } as WorkflowEvent], working());
  assert.deepEqual(verbOf(s, 0), { kind: "writing", text: "ran out of room — recovering what it found…" });
  assert.equal(verbOf(s, 1).kind, "thinking", "the sibling still at work is unaffected");

  // The recovery streams: still recovering, nothing settled yet.
  s = fold([{ type: "agent:produce", agentId: 1, text: "<tool_call>", tokenCount: 1 } as WorkflowEvent], s);
  assert.equal(verbOf(s, 0).text, "ran out of room — recovering what it found…");

  // The recovery lands: the section is kept, as any early-stopped section is.
  s = fold([{ type: "agent:recovered", agentId: 1, result: "what it found" } as WorkflowEvent], s);
  assert.equal(verbOf(s, 0).kind, "kept");
  assert.equal(selectSections(s)[0].prose, "what it found");
});

test("a recovery that fails ends the recovering state as a failure", () => {
  let s = fold([{ type: "agent:done", agentId: 1, reason: "pressure_critical" } as WorkflowEvent], working());
  s = fold([{ type: "agent:failed", agentId: 1, reason: "recovery_skipped" } as WorkflowEvent], s);
  assert.equal(verbOf(s, 0).kind, "failed");
});

test("an inquiry that settles on its own terms never passes through the recovering state", () => {
  const s = fold([{ type: "agent:return", agentId: 2, result: "its section" } as WorkflowEvent], working());
  assert.deepEqual(verbOf(s, 1), { kind: "settled", text: "wrote its section" });
});
