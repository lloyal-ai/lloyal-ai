/**
 * Fold-level tests for the view's state: the boot header, turn boundaries, the
 * article's survival across a warm turn and a failed one, and how an agent's
 * tool calls pair with their results. Pure — the real `reduce`, no DOM, no
 * model.
 *
 * These are the invariants every surface depends on: the terminal, the Electron
 * window and the browser all fold this one function, so a break here breaks all
 * three at once and none of them would say so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent } from "../../src/harness/protocol.js";

const fold = (events: WorkflowEvent[], from: AppState = initialState): AppState =>
  events.reduce(reduce, from);

const READY = {
  type: "ready",
  facts: { model: { id: "qwen3.5-4b", sizeBytes: 2_740_937_888 }, abilities: ["wikipedia"] },
} as WorkflowEvent;

/** A settled cold turn — the precondition every warm path starts from. */
const settled = (): AppState =>
  fold([
    READY,
    { type: "query", text: "What is the Antikythera mechanism?", warm: false } as WorkflowEvent,
    { type: "answer", text: "## The article" } as WorkflowEvent,
  ]);

test("boot: `ready` leaves booting and carries the measured facts", () => {
  const s = fold([READY]);
  assert.equal(s.phase, "ready");
  assert.equal(s.boot?.model.id, "qwen3.5-4b");
  assert.equal(s.boot?.model.sizeBytes, 2_740_937_888);
  assert.deepEqual(s.boot?.abilities, ["wikipedia"]);
});

test("boot: a later `ready` never drags a working session back to ready", () => {
  const s = fold([READY, { type: "query", text: "Q", warm: false } as WorkflowEvent, READY]);
  assert.equal(s.phase, "working");
});

test("a cold turn takes the page's title and clears the previous article", () => {
  const s = fold([{ type: "query", text: "Q2", warm: false } as WorkflowEvent], settled());
  assert.equal(s.phase, "working");
  assert.equal(s.turn, 2);
  assert.equal(s.topic, "Q2");
  assert.equal(s.answer, "");
});

test("a warm turn keeps BOTH the title and the article it is extending", () => {
  const before = settled();
  const s = fold([{ type: "query", text: "follow-up", warm: true } as WorkflowEvent], before);
  assert.equal(s.topic, before.topic, "a follow-up must not retitle a page that is now about more");
  assert.equal(s.answer, "## The article", "blanking the page would empty it for the whole synthesis");
  assert.equal(s.turn, 2);
});

test("a failed turn keeps the article the reader already has", () => {
  const s = fold([{ type: "error", message: "boom" } as WorkflowEvent], settled());
  assert.equal(s.phase, "error");
  assert.equal(s.error, "boom");
  assert.equal(s.answer, "## The article");
});

test("agents carry the turn that spawned them, so history stays distinguishable", () => {
  const s = fold(
    [
      { type: "agent:spawn", agentId: 3, parentAgentId: 0 } as WorkflowEvent,
      { type: "query", text: "Q2", warm: true } as WorkflowEvent,
      { type: "agent:spawn", agentId: 4, parentAgentId: 0 } as WorkflowEvent,
    ],
    settled(),
  );
  assert.equal(s.agents.get(3)?.turn, 1);
  assert.equal(s.agents.get(4)?.turn, 2);
  assert.equal(s.agents.size, 2, "earlier turns' agents are the record of how the page was composed");
});

test("produce takes the running total, never the sum of deltas", () => {
  const s = fold([
    { type: "agent:spawn", agentId: 1, parentAgentId: 0 } as WorkflowEvent,
    { type: "agent:produce", agentId: 1, text: "a", tokenCount: 10 } as WorkflowEvent,
    { type: "agent:produce", agentId: 1, text: "b", tokenCount: 20 } as WorkflowEvent,
  ]);
  assert.equal(s.agents.get(1)?.tokens, 20, "summing a cumulative count is quadratic and wrong");
  assert.equal(s.agents.get(1)?.body, "ab");
});

test("a tool result fills its own in-flight call, not another tool's", () => {
  const s = fold([
    { type: "agent:spawn", agentId: 1, parentAgentId: 0 } as WorkflowEvent,
    { type: "agent:tool_call", agentId: 1, tool: "wikipedia_search", args: '{"query":"x"}' } as WorkflowEvent,
    { type: "agent:tool_call", agentId: 1, tool: "wikipedia_fetch", args: '{"title":"y"}' } as WorkflowEvent,
    { type: "agent:tool_result", agentId: 1, tool: "wikipedia_fetch", result: '{"title":"y"}' } as WorkflowEvent,
  ]);
  const tools = s.agents.get(1)?.tools ?? [];
  assert.equal(tools.length, 2);
  assert.equal(tools[0].result, null, "the search call is still in flight");
  assert.equal(tools[1].result, '{"title":"y"}');
});

test("an event for an unknown agent is ignored rather than inventing one", () => {
  const s = fold([{ type: "agent:produce", agentId: 99, text: "x", tokenCount: 1 } as WorkflowEvent]);
  assert.equal(s.agents.size, 0);
});

test("kv pressure comes off the tick", () => {
  const s = fold([{ type: "agent:tick", cellsUsed: 4096, nCtx: 32768 } as WorkflowEvent]);
  assert.deepEqual(s.kv, { used: 4096, total: 32768 });
});

test("the fold is immutable — no event mutates the state handed to it", () => {
  const before = settled();
  const agentsBefore = before.agents;
  const after = fold([{ type: "agent:spawn", agentId: 7, parentAgentId: 0 } as WorkflowEvent], before);
  assert.notEqual(after.agents, agentsBefore, "a new Map, so a renderer's identity check sees the change");
  assert.equal(agentsBefore.size, 0, "the previous state must not have gained an agent");
});
