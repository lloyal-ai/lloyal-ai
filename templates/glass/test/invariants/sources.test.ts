import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, emptyWork, reduce } from "../../src/ui/state.js";
import { returnedSources } from "../../src/ui/sources.js";

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
