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
});

test("replayed token by token, the head is parsed once per block and the bytes parsed stay linear", () => {
  const DELTA = 4;
  const blanks = (document.match(/\n\n/g) ?? []).length;
  let headParses = 0;
  let lastHead = "";
  let bytesSplit = 0;
  let bytesWhole = 0;
  for (let n = DELTA; n <= document.length + DELTA; n += DELTA) {
    const buffer = document.slice(0, n);
    const { head, tail } = splitStreaming(buffer);
    assert.equal(head + tail, buffer, "the split loses nothing");
    if (head !== lastHead) { headParses++; bytesSplit += head.length; lastHead = head; }
    bytesSplit += tail.length;
    bytesWhole += buffer.length;
  }
  assert.ok(headParses <= blanks + 1, `head parsed ${headParses} times for ${blanks} blank lines`);
  // The bound that holds at any length: the tail costs at most the longest block per token, the head at most
  // the document per block. Whole-buffer parsing is quadratic in the stream and has no such bound.
  const longestBlock = Math.max(...document.split("\n\n").map((b) => b.length + 2));
  const steps = Math.ceil(document.length / DELTA) + 1;
  assert.ok(bytesSplit <= steps * longestBlock + headParses * document.length,
    `split parsed ${bytesSplit} bytes; bound ${steps * longestBlock + headParses * document.length}`);
  // Measured on this fixture: 575 KB against 10.3 MB, 18×; the ratio grows with the document.
  assert.ok(bytesSplit * 10 < bytesWhole, `split parsed ${bytesSplit} bytes vs whole ${bytesWhole}`);
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
