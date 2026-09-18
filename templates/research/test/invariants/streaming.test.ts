/**
 * The cost of rendering prose as it streams must not grow with the prose. The view hands the markdown
 * renderer two strings: the finished blocks (parsed once, kept while they stand) and the block still being
 * written (parsed per token). This replays a document token by token through that split and counts what a
 * memoized renderer would parse — the head is parsed only when it changes, the tail every time — against
 * parsing the whole buffer every token, which is what froze the tab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitStreaming } from "../../src/ui/streaming.js";

const paragraph = (i: number): string =>
  `Paragraph ${i} of the brief says something at the length a model writes, with a [citation](https://x/${i}) ` +
  "and enough words that a token lands in it many times before it ends.".repeat(2);

const section = (k: number): string[] => [
  "## Heading one",
  paragraph(k),
  "- a list item\n- another item\n- a third",
  paragraph(k + 1),
  "```ts\nconst inFence = true;\n\n// a blank line INSIDE the fence\nexport {};\n```",
  "## Heading one",
  paragraph(k + 2),
  "> a quote\n> continued",
  paragraph(k + 3),
];
// About the size of a settled brief (8–10 KB), which is where the whole-buffer cost showed.
const document = Array.from({ length: 8 }, (_, i) => section(i * 4)).flat().join("\n\n") + "\n";

test("the tail never starts inside an open fence, and a finished document splits at its last blank line", () => {
  assert.deepEqual(splitStreaming("no blank line yet"), { head: "", tail: "no blank line yet" });
  assert.deepEqual(splitStreaming("done.\n\nnext"), { head: "done.\n\n", tail: "next" });
  const open = "before\n\n```\ncode\n\nmore code";
  assert.deepEqual(splitStreaming(open), { head: "before\n\n", tail: "```\ncode\n\nmore code" });
  const closed = "before\n\n```\ncode\n\nmore\n```\n\nafter";
  assert.deepEqual(splitStreaming(closed), { head: "before\n\n```\ncode\n\nmore\n```\n\n", tail: "after" });
  assert.equal(splitStreaming("").tail, "");
  // A fence inside a list item is indented; it still owns its blank lines.
  const nested = "- item\n\n  ```\n  code\n\n  more";
  assert.deepEqual(splitStreaming(nested), { head: "- item\n\n", tail: "  ```\n  code\n\n  more" });
  // A fence closes only on the same character, at least as long: a shorter run inside it is content.
  const longer = "before\n\n````md\ncode\n\n```\nstill code\n\nmore";
  assert.deepEqual(splitStreaming(longer), { head: "before\n\n", tail: "````md\ncode\n\n```\nstill code\n\nmore" });
  const tilde = "before\n\n~~~\ncode\n\n```\nstill code";
  assert.deepEqual(splitStreaming(tilde), { head: "before\n\n", tail: "~~~\ncode\n\n```\nstill code" });
});

/** Replay `text` in `DELTA`-char deltas and account for what a memoized renderer parses: the head only
 *  when it changes, the tail every time. Returns the per-token maximum and the totals. */
const replay = (text: string, DELTA: number) => {
  let headParses = 0;
  let lastHead = "";
  let bytesSplit = 0;
  let bytesWhole = 0;
  let worstToken = 0;
  let worstTail = 0;
  for (let n = DELTA; n <= text.length + DELTA; n += DELTA) {
    const buffer = text.slice(0, n);
    const { head, tail } = splitStreaming(buffer);
    assert.equal(head + tail, buffer, "the split loses nothing");
    let cost = tail.length;
    if (head !== lastHead) { headParses++; cost += head.length; lastHead = head; }
    bytesSplit += cost;
    bytesWhole += buffer.length;
    worstToken = Math.max(worstToken, cost);
    worstTail = Math.max(worstTail, tail.length);
  }
  return { headParses, bytesSplit, bytesWhole, worstToken, worstTail };
};

test("replayed token by token, a token costs one block — the head once per block, never per token", () => {
  const DELTA = 4;
  const blanks = (document.match(/\n\n/g) ?? []).length;
  const longestBlock = Math.max(...document.split("\n\n").map((b) => b.length + 2));
  const r = replay(document, DELTA);
  // What the freeze was: every token parsed the whole buffer. What holds now, per token: the block under
  // the caret, plus the whole head once when a block completes. The head is one cumulative memo, so the
  // total is still quadratic in the number of blocks (each completed block re-parses those before it) —
  // a parse per ~75 tokens, not per token — and the per-token bound is what keeps the main thread free.
  assert.ok(r.headParses <= blanks + 1, `head parsed ${r.headParses} times for ${blanks} blank lines`);
  assert.ok(r.worstTail <= longestBlock, `a tail of ${r.worstTail} exceeds the longest block ${longestBlock}`);
  assert.ok(r.worstToken <= longestBlock + document.length, "a token never costs more than the head and one block");
  // Measured on this fixture: 575 KB against 10.3 MB, 18×. The ratio rises with the document toward a
  // quarter of the block length, then holds — it does not grow without bound.
  assert.ok(r.bytesSplit * 10 < r.bytesWhole, `split parsed ${r.bytesSplit} bytes vs whole ${r.bytesWhole}`);
  const half = replay(document.slice(0, Math.floor(document.length / 2)), DELTA);
  assert.ok(half.bytesWhole / half.bytesSplit < r.bytesWhole / r.bytesSplit, "the saving grows with the document");
});

// The other half of "parsed once": a memoized view stays skipped only if no projection inside it changes
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
