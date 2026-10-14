import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, emptyWork, reduce } from "../../src/ui/state.js";
import { returnedSources, sourceProgress } from "../../src/ui/sources.js";

test("source progress uses returned tool metadata, deduplicates pages and refuses unsafe links", () => {
  let state = { ...initialState, work: emptyWork("one", "turn") };
  state = reduce(state, {
    type: "agent:spawn",
    agentId: 1,
    key: "part",
  }) as typeof state;
  state = reduce(state, {
    type: "agent:tool_call",
    agentId: 1,
    tool: "web_search",
    args: '{"query":"example"}',
  }) as typeof state;
  assert.equal(returnedSources(state.work.roster.agents.values()).length, 0);
  state = reduce(state, {
    type: "agent:tool_result",
    agentId: 1,
    tool: "web_search",
    result: JSON.stringify([
      {
        url: "https://example.com/page#first",
        title: "One",
        icon: "https://example.com/icon.png",
      },
      { url: "https://example.com/page#second", title: "One again" },
      {
        url: "https://example.com/other",
        title: "Two",
        icon: "javascript:bad()",
      },
      { url: "javascript:bad()", title: "Unsafe destination" },
    ]),
  }) as typeof state;
  state = reduce(state, {
    type: "agent:produce",
    agentId: 1,
    text: "I read 99 sources",
    tokenCount: 4,
  }) as typeof state;
  const sources = returnedSources(state.work.roster.agents.values());
  assert.equal(sources.length, 3);
  assert.equal(sources[0].title, "One again");
  assert.equal(sources[1].icon, undefined);
  assert.equal(sources[2].url, undefined);
});

test("removing a conversation removes its history and search entries together", () => {
  const a = { id: "removed", revision: 2, title: "Removed", updatedAt: "now" };
  const b = { id: "kept", revision: 1, title: "Kept", updatedAt: "now" };
  const next = reduce(
    {
      ...initialState,
      activeId: a.id,
      entries: [a, b],
      search: { query: "e", entries: [a, b] },
    },
    { type: "conversation:removed", id: a.id },
  );
  assert.equal(next.activeId, null);
  assert.deepEqual(next.entries, [b]);
  assert.deepEqual(next.search?.entries, [b]);
});

test("source icons arrive before completion, merge fetch metadata, and accumulate during later calls", () => {
  let state = { ...initialState, work: emptyWork("one", "turn") };
  const emit = (event: Parameters<typeof reduce>[1]) => {
    state = reduce(state, event) as typeof state;
  };
  const progress = () =>
    sourceProgress(
      state.work.roster.agents.values(),
      state.work.sourceRequests,
    );
  emit({ type: "agent:spawn", agentId: 1, key: "part" });
  emit({
    type: "agent:tool_call",
    agentId: 1,
    tool: "fetch_page",
    args: JSON.stringify({ url: "https://example.com/one" }),
  });
  assert.equal(progress().length, 1);
  assert.equal(progress()[0].opening, true);
  assert.equal(state.work.roster.agents.get(1)?.phase, "tool");
  emit({
    type: "agent:tool_result",
    agentId: 1,
    tool: "fetch_page",
    result: JSON.stringify({
      url: "https://example.com/one",
      title: "First page",
      icon: "https://example.com/icon.png",
    }),
  });
  assert.equal(progress().length, 1);
  assert.equal(progress()[0].title, "First page");
  assert.equal(progress()[0].opening, undefined);
  emit({
    type: "agent:tool_call",
    agentId: 1,
    tool: "web_search",
    args: '{"query":"more"}',
  });
  assert.equal(progress().length, 1);
  emit({
    type: "agent:tool_result",
    agentId: 1,
    tool: "web_search",
    result: JSON.stringify([
      { url: "https://example.com/one#section", title: "First again" },
      { url: "https://other.example/two", title: "Second" },
    ]),
  });
  assert.equal(progress().length, 2);
  assert.equal(progress()[0].icon, "https://example.com/icon.png");
  assert.notEqual(state.work.roster.agents.get(1)?.phase, "done");
  emit({
    type: "agent:tool_call",
    agentId: 1,
    tool: "fetch_page",
    args: '{"url":"https://other.example/two"}',
  });
  assert.equal(progress().length, 2);
  assert.equal(progress()[1].opening, true);
});

test("failed or stopped fetches do not remain opening or become returned sources", () => {
  let state = { ...initialState, work: emptyWork("one", "turn") };
  const emit = (event: Parameters<typeof reduce>[1]) => {
    state = reduce(state, event) as typeof state;
  };
  const progress = () =>
    sourceProgress(
      state.work.roster.agents.values(),
      state.work.sourceRequests,
    );
  emit({ type: "agent:spawn", agentId: 1, key: "part" });
  emit({
    type: "agent:tool_call",
    agentId: 1,
    tool: "fetch_page",
    args: '{"url":"javascript:bad()"}',
  });
  assert.equal(progress().length, 0);
  emit({
    type: "agent:tool_call",
    agentId: 1,
    tool: "fetch_page",
    args: '{"url":"https://example.com/failure"}',
  });
  emit({
    type: "agent:tool_result",
    agentId: 1,
    tool: "fetch_page",
    result: '{"url":"https://example.com/failure","error":"Unavailable"}',
  });
  assert.equal(progress().length, 0);
  emit({
    type: "agent:tool_call",
    agentId: 1,
    tool: "fetch_page",
    args: '{"url":"https://example.com/stopped"}',
  });
  emit({ type: "agent:done", agentId: 1, reason: "stopped" });
  assert.equal(progress().length, 0);
  emit({
    type: "work:ended",
    conversationId: "one",
    turnId: "turn",
    reason: "stopped",
  });
  assert.deepEqual(state.work.sourceRequests, {});
});

test("progress follows the selected agents and a new turn starts empty", () => {
  let state = { ...initialState, work: emptyWork("one", "turn") };
  const emit = (event: Parameters<typeof reduce>[1]) => {
    state = reduce(state, event) as typeof state;
  };
  emit({ type: "agent:spawn", agentId: 1, key: "part1" });
  emit({ type: "agent:spawn", agentId: 2, key: "part2" });
  emit({
    type: "agent:tool_call",
    agentId: 1,
    tool: "fetch_page",
    args: '{"url":"https://example.com/one"}',
  });
  assert.equal(
    sourceProgress(
      [state.work.roster.agents.get(2)!],
      state.work.sourceRequests,
    ).length,
    0,
  );
  emit({ type: "work:start", conversationId: "one", turnId: "next" });
  assert.equal(
    sourceProgress(state.work.roster.agents.values(), state.work.sourceRequests)
      .length,
    0,
  );
});
