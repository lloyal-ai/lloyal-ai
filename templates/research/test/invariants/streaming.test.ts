/**
 * The cost of rendering prose as it streams must not grow with the prose. The split that keeps it bounded is
 * ui's (`@lloyal-labs/ui/prose`, proven there); what is this app's is the OTHER half of "parsed once": a
 * memoized view stays skipped only if no projection inside it changes identity on folds that touched nothing
 * of its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// A memoized view stays skipped only if no projection inside it changes
// identity on folds that touched nothing of its own. `useProjection` compares snapshots by identity, so a
// selector that returns a fresh array re-renders its subscriber on EVERY token — which is what re-parsed
// every settled section while the settling pass streamed.
test("a synth token changes the digest list's identity but not its key", async () => {
  const { reduce, initialState } = await import("../../src/ui/state.js");
  const { selectThreadDigests, selectThreadDigestKey } = await import("../../src/ui/select.js");
  type Ev = Parameters<typeof reduce>[1];
  const fold = (events: Ev[]) => events.reduce(reduce, initialState);
  const started = fold([
    { type: "query", docId: "d1", query: "Q", warm: false } as Ev,
    { type: "synthesize:start" } as Ev,
    { type: "agent:produce", agentId: 9, text: "one " } as Ev,
  ]);
  const next = reduce(started, { type: "agent:produce", agentId: 9, text: "two " } as Ev);
  assert.notEqual(selectThreadDigests(started), selectThreadDigests(next), "an array is a new identity per fold");
  assert.ok(Object.is(selectThreadDigestKey(started), selectThreadDigestKey(next)), "the key is the same value");
});

// The same trap at the settled answer: `Settle` hands `Prose` a citations Map built from `selectCitations`.
// A fresh array per fold means a fresh Map per fold, and the whole settled answer re-parses on every token
// of a warm ask. The selector answers the same array while the answer body is the same.
test("a warm-ask token leaves the settled answer's citations identical", async () => {
  const { reduce, initialState } = await import("../../src/ui/state.js");
  const { selectCitations } = await import("../../src/ui/select.js");
  type Ev = Parameters<typeof reduce>[1];
  const fold = (events: Ev[]) => events.reduce(reduce, initialState);
  const settled = fold([
    { type: "query", docId: "d1", query: "Q", warm: false } as Ev,
    { type: "plan:start", query: "Q", mode: "flat" } as Ev,
    { type: "plan", intent: "research", tasks: [{ description: "a" }], tokenCount: 1, timeMs: 1 } as Ev,
    { type: "research:start", agentCount: 1, mode: "flat" } as Ev,
    { type: "answer", text: "cited [once](https://a.b/1) and [twice](https://a.b/2)." } as Ev,
    { type: "complete", data: { wallTimeMs: 1, planMs: 0, researchMs: 0, synthMs: 0, passthroughMs: 0 } } as Ev,
    { type: "query", docId: "d1", query: "follow-up", warm: true } as Ev,
    { type: "agent:produce", agentId: 9, text: "one " } as Ev,
  ]);
  const next = reduce(settled, { type: "agent:produce", agentId: 9, text: "two " } as Ev);
  assert.equal(selectCitations(settled).length, 2, "the settled answer's two sources");
  assert.ok(Object.is(selectCitations(settled), selectCitations(next)), "the same array while the answer stands");
});
