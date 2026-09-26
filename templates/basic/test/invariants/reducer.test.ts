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
import { reduce, initialState, articleOf, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent } from "../../src/protocol.js";

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
  assert.equal(s.topic, "Q2");
  assert.equal(s.answer, "");
});

test("a warm turn keeps BOTH the title and the article it is extending", () => {
  const before = settled();
  const s = fold([{ type: "query", text: "follow-up", warm: true } as WorkflowEvent], before);
  assert.equal(s.topic, before.topic, "a follow-up must not retitle a page that is now about more");
  assert.equal(s.answer, "## The article", "blanking the page would empty it for the whole synthesis");
});

test("a warm turn keeps what SUPPORTS the article too", () => {
  // The article and its sources are one thing on screen. Clearing the sources while keeping the article — which
  // is what a follow-up that finds nothing, or one that is stopped, leaves behind — shows a page that states
  // less than it knows, with no way for the reader to tell why its citations went away.
  const before = fold(
    [
      { type: "agent:spawn", agentId: 1, parentAgentId: 0 } as WorkflowEvent,
      { type: "agent:tool_call", agentId: 1, tool: "wikipedia_search", args: '{"query":"antikythera"}' } as WorkflowEvent,
      {
        type: "agent:tool_result",
        agentId: 1,
        tool: "wikipedia_fetch",
        result: '{"title":"Antikythera mechanism","extract":"An ancient device.","url":"https://en.wikipedia.org/wiki/X"}',
      } as WorkflowEvent,
    ],
    settled(),
  );
  assert.equal(before.sources.length, 1);

  const warm = fold([{ type: "query", text: "follow-up", warm: true } as WorkflowEvent], before);
  assert.deepEqual(warm.sources, before.sources, "the article survives the turn, so its sources must too");
  assert.deepEqual(warm.queries, before.queries, "and what was searched to build it");

  const cold = fold([{ type: "query", text: "Q2", warm: false } as WorkflowEvent], before);
  assert.deepEqual(cold.sources, [], "a new page starts with nothing behind it");
  assert.deepEqual(cold.queries, []);
});

test("a turn that dies keeps the article the reader already has", () => {
  const s = fold([{ type: "run:aborted" } as WorkflowEvent], settled());
  assert.equal(s.answer, "## The article", "a stopped turn is no reason to blank the page");
  assert.equal(s.phase, "answered", "the page decides the phase: an article on screen is an answered page");
});

test("a toast does not end a turn — `ui:error` shows a message and nothing else", () => {
  // The two facts were ONE event until step 6, and folding them together meant a benign failure — a bad
  // config path, an ability that would not start — read on screen exactly like a turn that died. They are
  // separate events now, so a toast arriving mid-turn must leave the turn running.
  const working = fold([{ type: "query", text: "Q", warm: false } as WorkflowEvent]);
  const s = fold([{ type: "ui:error", message: "boom" } as WorkflowEvent], working);
  assert.equal(s.error, "boom");
  assert.equal(s.phase, "working", "a toast is not an ending");
});

test("a new question starts a fresh roster — the page is the record, not the agents", () => {
  const s = fold(
    [
      { type: "agent:spawn", agentId: 3, parentAgentId: 0 } as WorkflowEvent,
      { type: "query", text: "Q2", warm: true } as WorkflowEvent,
      { type: "agent:spawn", agentId: 4, parentAgentId: 0 } as WorkflowEvent,
    ],
    settled(),
  );
  assert.deepEqual([...s.roster.agents.keys()], [4], "the previous turn's agents are not this turn's work");
  assert.equal(s.answer, "## The article", "what the previous turn produced is what survives it");
});

// What each agent is DOING is ui's fold, and ui tests it. What follows is basic's own: the Wikipedia pages
// behind the article, read from the tools' raw payloads that a runtime roster has no reason to keep.

test("an agent spawning outside a turn does not make the app look busy", () => {
  // The topic classifier spawns at boot. If a spawn meant "working", the landing would show "Reading
  // Wikipedia…" with the shelf it is classifying hidden behind that branch — the grouping blocking the very
  // render it exists to improve.
  const s = fold([READY, { type: "agent:spawn", agentId: 9, parentAgentId: 0 } as WorkflowEvent]);
  assert.equal(s.phase, "ready", "only `query` says a turn began");
});

test("a question ends the grouping it evicted, however the turn goes", () => {
  // A question replaces the classifier's run, and a halted operation says nothing on its way out. So the
  // question itself is the end of that grouping — otherwise a turn that then failed would land back on the
  // shelf with a spinner nothing would ever stop.
  const s = fold([
    READY,
    { type: "library", articles: [], groups: null, grouping: true } as WorkflowEvent,
    { type: "query", text: "what is a solid-state cell?", warm: false } as WorkflowEvent,
    { type: "run:aborted" } as WorkflowEvent,
  ]);
  assert.equal(s.grouping, false, "the shelf the reader comes back to is not still sorting");
});

test("a fetched article becomes a source, once", () => {
  const page = '{"title":"Antikythera mechanism","extract":"An ancient device.","url":"https://en.wikipedia.org/wiki/X"}';
  const s = fold([
    { type: "agent:spawn", agentId: 1, parentAgentId: 0 } as WorkflowEvent,
    { type: "agent:tool_result", agentId: 1, tool: "wikipedia_fetch", result: page } as WorkflowEvent,
    // A second agent reading the same page must not put it on the shelf twice.
    { type: "agent:spawn", agentId: 2, parentAgentId: 0 } as WorkflowEvent,
    { type: "agent:tool_result", agentId: 2, tool: "wikipedia_fetch", result: page } as WorkflowEvent,
  ]);
  assert.equal(s.sources.length, 1);
  assert.equal(s.sources[0].title, "Antikythera mechanism");
  assert.equal(s.sources[0].snippet, "An ancient device.");
});

test("a fetch that failed is not a source", () => {
  const s = fold([
    { type: "agent:spawn", agentId: 1, parentAgentId: 0 } as WorkflowEvent,
    { type: "agent:tool_result", agentId: 1, tool: "wikipedia_fetch", result: '{"title":"X","error":"Article not found."}' } as WorkflowEvent,
  ]);
  assert.deepEqual(s.sources, [], "an error payload is not a page the reader can be shown");
});

test("the searches are kept, each once, in the order they were run", () => {
  const s = fold([
    { type: "agent:spawn", agentId: 1, parentAgentId: 0 } as WorkflowEvent,
    { type: "agent:tool_call", agentId: 1, tool: "wikipedia_search", args: '{"query":"antikythera"}' } as WorkflowEvent,
    { type: "agent:tool_call", agentId: 1, tool: "wikipedia_fetch", args: '{"title":"X"}' } as WorkflowEvent,
    { type: "agent:tool_call", agentId: 1, tool: "wikipedia_search", args: '{"query":"antikythera"}' } as WorkflowEvent,
    { type: "agent:tool_call", agentId: 1, tool: "wikipedia_search", args: '{"query":"greek astronomy"}' } as WorkflowEvent,
  ]);
  assert.deepEqual(s.queries, ["antikythera", "greek astronomy"]);
});

test("an event for an unknown agent is ignored rather than inventing one", () => {
  const s = fold([{ type: "agent:produce", agentId: 99, text: "x", tokenCount: 1 } as WorkflowEvent]);
  assert.equal(s.roster.agents.size, 0);
});

test("kv pressure comes off the tick", () => {
  const s = fold([{ type: "agent:tick", cellsUsed: 4096, nCtx: 32768 } as WorkflowEvent]);
  assert.deepEqual(s.kv, { used: 4096, total: 32768 });
});

test("the fold is immutable — no event mutates the state handed to it", () => {
  const before = settled();
  const rosterBefore = before.roster;
  const after = fold([{ type: "agent:spawn", agentId: 7, parentAgentId: 0 } as WorkflowEvent], before);
  assert.notEqual(after.roster, rosterBefore, "a new roster, so a renderer's identity check sees the change");
  assert.equal(rosterBefore.agents.size, 0, "the previous state must not have gained an agent");
});

// ── the page: what it shows, and how a kept article comes back onto it ──

/** A turn whose settling agent has filed its draft — the moment before the answer is accepted. */
const drafted = (warm: boolean, from: AppState): AppState =>
  fold(
    [
      { type: "query", text: "Q", warm } as WorkflowEvent,
      { type: "agent:spawn", agentId: 5, parentAgentId: 0 } as WorkflowEvent,
      { type: "agent:return", agentId: 5, result: "## Draft" } as WorkflowEvent,
    ],
    from,
  );

test("while a turn works, the page shows the settling agent's draft", () => {
  assert.equal(articleOf(drafted(false, fold([READY]))), "## Draft");
});

test("a draft whose save failed is never shown: the turn is over and nothing was accepted", () => {
  const s = fold(
    [{ type: "run:aborted" }, { type: "ui:error", message: "EACCES" }] as WorkflowEvent[],
    drafted(false, fold([READY])),
  );
  assert.equal(articleOf(s), "", "the page shows only an article the session accepted");
  assert.equal(s.phase, "ready");
});

test("a follow-up whose save failed leaves the article it was extending", () => {
  const s = fold([{ type: "run:aborted" } as WorkflowEvent], drafted(true, settled()));
  assert.equal(articleOf(s), "## The article");
});

test("a kept article loaded from disk does not change the page until it is shown", () => {
  const s = fold([{ type: "doc", docId: "d1", title: "Kept", answer: "## Kept" } as WorkflowEvent], settled());
  assert.equal(articleOf(s), "## The article");
  assert.equal(s.documents.get("d1")?.answer, "## Kept");
});

test("showing a kept article puts it on the page, with nothing that worked on the previous one", () => {
  const page = '{"title":"Antikythera mechanism","extract":"An ancient device.","url":"https://en.wikipedia.org/wiki/X"}';
  const before = fold(
    [
      { type: "agent:spawn", agentId: 1, parentAgentId: 0 } as WorkflowEvent,
      { type: "agent:tool_result", agentId: 1, tool: "wikipedia_fetch", result: page } as WorkflowEvent,
    ],
    settled(),
  );
  const s = fold(
    [
      { type: "doc", docId: "d1", title: "Kept", answer: "## Kept" },
      { type: "doc:active", docId: "d1" },
    ] as WorkflowEvent[],
    before,
  );
  assert.equal(articleOf(s), "## Kept");
  assert.equal(s.topic, "Kept");
  assert.equal(s.phase, "answered");
  assert.deepEqual(s.sources, [], "the previous page's sources are not this article's");
  assert.equal(s.roster.agents.size, 0, "nor are its agents");
});

test("the landing is no page at all", () => {
  const s = fold([{ type: "doc:active", docId: null } as WorkflowEvent], settled());
  assert.equal(articleOf(s), "");
  assert.equal(s.topic, "");
  assert.equal(s.phase, "ready");
});
