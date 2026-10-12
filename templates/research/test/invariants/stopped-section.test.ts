/**
 * A stopped report is shown as stopped (LLO-44). The fold keeps the streamed
 * draft and the drop's reason at `agent:done`; the section settles to the kept
 * text and shows what was not kept as a visible tail, in the reader's words,
 * never as a silent swap. The reason names the cause in the reader's sense of
 * "failed": the inquiry did not get a normal round.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRoster, foldAgents } from "@lloyal-labs/ui/fold";
import type { AgentEvent, AgentRoster, AgentRuntime } from "@lloyal-labs/ui/fold";
import { proseOf, verbOf } from "../../src/ui/select.js";

const REPORTS = { tool: "report", field: "result" };
const opts = { spawn: () => ({ timeline: true, taskIndex: 0 }), terminal: "report", now: () => 1000 };
const fold = (evs: AgentEvent[]): AgentRuntime =>
  evs.reduce<AgentRoster>((r, ev) => foldAgents(r, ev, opts), emptyRoster()).agents.get(1)!;
const spawn: AgentEvent = { type: "agent:spawn", agentId: 1 };
const produce = (text: string, tokenCount: number): AgentEvent => ({ type: "agent:produce", agentId: 1, text, tokenCount });

const KEPT = "## Findings\n\nThe first regime requires a study";
const STREAMED = `${KEPT} before any project above 20 MW\n\n| a | b |\n|---|---|\n| 1 |`;
const envelope = (body: string): string => `<tool_call>\n<function=report>\n<parameter=result>\n${body}`;

test("a salvage: the kept text settles, the words beyond it are the tail, and the row names the cause", () => {
  const a = fold([
    spawn, produce("x</think>", 1), produce(envelope(STREAMED), 40),
    { type: "agent:done", agentId: 1, reason: "pressure_critical" },
    { type: "agent:recovered", agentId: 1, result: KEPT },
  ]);
  const section = proseOf(a, REPORTS);
  assert.equal(section.prose, KEPT);
  assert.equal(section.streaming, false);
  assert.equal(section.draft, null);
  assert.deepEqual(section.stopped, { note: "ran out of room — kept to here", tail: STREAMED.slice(KEPT.length) });
  assert.deepEqual(verbOf(a, REPORTS), { kind: "kept", text: "ran out of room — kept what it had" });
});

test("kept text equal to the draft: a stop with nothing lost shows the note and no tail", () => {
  const a = fold([
    spawn, produce("x</think>", 1), produce(envelope(KEPT), 40),
    { type: "agent:done", agentId: 1, reason: "terminal_cap" },
    { type: "agent:recovered", agentId: 1, result: KEPT },
  ]);
  assert.deepEqual(proseOf(a, REPORTS).stopped, { note: "reached the report length — kept to here", tail: null });
  assert.deepEqual(verbOf(a, REPORTS), { kind: "kept", text: "reached the report length — kept to here" });
});

test("a kept text that is not a prefix of the draft: the report stands, the note says the draft was replaced", () => {
  const a = fold([
    spawn, produce("x</think>", 1), produce(envelope(STREAMED), 40),
    { type: "agent:done", agentId: 1, reason: "pressure_critical" },
    { type: "agent:recovered", agentId: 1, result: "A different write-up" },
  ]);
  const section = proseOf(a, REPORTS);
  assert.equal(section.prose, "A different write-up");
  assert.deepEqual(section.stopped, { note: "ran out of room — an earlier draft was replaced", tail: null });
});

test("a stopped report whose write-up has not landed: the draft is frozen, the recovery streams beneath it", () => {
  const a = fold([
    spawn, produce("x</think>", 1), produce(envelope(STREAMED), 40),
    { type: "agent:done", agentId: 1, reason: "wind_down" },
    produce("What it found, in short", 50),
  ]);
  const section = proseOf(a, REPORTS);
  assert.equal(section.draft, STREAMED);
  assert.equal(section.prose, "What it found, in short");
  assert.equal(section.streaming, true);
  assert.deepEqual(section.stopped, { note: "closed early — writing up what it found", tail: null });
  assert.deepEqual(verbOf(a, REPORTS), { kind: "writing", text: "closed early — settling the section into the brief" });
});

test("a working turn dropped mid call: its JSON is no draft and the section shows nothing of it", () => {
  const a = fold([
    spawn, produce("x</think>", 1), produce('<tool_call>{"name":"web_search"', 5),
    { type: "agent:done", agentId: 1, reason: "policy_exit" },
  ]);
  const section = proseOf(a, REPORTS);
  assert.equal(section.draft, null);
  assert.equal(section.prose, null);
  assert.equal(section.stopped, null);
  assert.deepEqual(verbOf(a, REPORTS), { kind: "writing", text: "out of time — settling the section into the brief" });
});

test("a voluntary return is untouched: settled, no stop, no tail", () => {
  const a = fold([
    spawn, produce("x</think>", 1), produce(envelope(KEPT), 40),
    { type: "agent:tool_call", agentId: 1, tool: "report", args: JSON.stringify({ result: KEPT }) },
    { type: "agent:return", agentId: 1, result: KEPT },
    { type: "agent:done", agentId: 1 },
  ]);
  const section = proseOf(a, REPORTS);
  assert.equal(section.prose, KEPT);
  assert.equal(section.stopped, null);
  assert.deepEqual(verbOf(a, REPORTS), { kind: "settled", text: "wrote its section" });
});

test("a salvage whose parse failed: the row fails, the draft shows as not kept", () => {
  const a = fold([
    spawn, produce("x</think>", 1), produce(envelope(STREAMED), 40),
    { type: "agent:done", agentId: 1, reason: "pressure_critical" },
    { type: "agent:failed", agentId: 1, reason: "no_terminal_call" },
  ]);
  const section = proseOf(a, REPORTS);
  assert.equal(section.prose, null);
  assert.deepEqual(section.stopped, { note: "ran out of room — nothing could be kept", tail: STREAMED });
  assert.deepEqual(verbOf(a, REPORTS), { kind: "failed", text: "couldn't finish this line of inquiry" });
});
