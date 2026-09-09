/**
 * An upload has to stop for two reasons: too many bytes, and too much time.
 *
 * The byte cap is the easy half. The deadline is where this went wrong twice:
 * a signal checked BETWEEN reads is only ever consulted when a read resolves,
 * and the case that needs a deadline is exactly the one where none does. These
 * drive a stream that never yields, so the failure takes milliseconds to prove
 * rather than the three minutes the real ceiling allows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBounded, TooLarge, TooSlow } from "../../targets/desktop/read-bounded.js";

/** A body that yields the given chunks, then stays open forever. */
function stream(chunks: Uint8Array[] = [], onCancel?: () => void): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(chunks[i++]);
      // else: never enqueue, never close — a producer that went quiet.
    },
    cancel() { onCancel?.(); },
  });
}

const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(7);

test("a stalled stream is abandoned at the deadline, not waited out", async () => {
  const ctrl = new AbortController();
  let cancelled = false;
  const started = Date.now();
  setTimeout(() => ctrl.abort(), 30);
  await assert.rejects(
    () => readBounded(stream([bytes(8)], () => { cancelled = true; }), 1024, ctrl.signal),
    TooSlow,
  );
  // The point: it returned on the ABORT, not on the stream, which never ends.
  assert.ok(Date.now() - started < 2_000, "should reject at the deadline");
  // Cancellation is started so the producer stops; it is never awaited.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cancelled, true, "the reader should have been cancelled");
});

test("a signal already aborted is refused before a byte is read", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes(8)); } });
  await assert.rejects(() => readBounded(body, 1024, ctrl.signal), TooSlow);
  // `locked` is the honest witness: `getReader()` is what locks a stream, and
  // an untouched body is one nothing ever tried to read. (A stream pulls once
  // on its own to fill its queue, so counting pulls would measure the stream.)
  assert.equal(body.locked, false, "the body should never have been opened");
});

test("reaching EOF after the deadline is still a refusal", async () => {
  const ctrl = new AbortController();
  // A stream that closes only AFTER the deadline has passed: the loop can exit
  // on `done` with the signal already aborted, and those bytes must not go on
  // to be ingested for a caller that stopped waiting.
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Close FIRST: the read then wins the race and the loop exits on `done`
      // with the signal already aborted — which is the only path the recheck
      // below the loop covers. Abort first and the race catches it instead,
      // and this test would pass with that recheck deleted.
      setTimeout(() => { c.close(); ctrl.abort(); }, 20);
    },
  });
  await assert.rejects(() => readBounded(body, 1024, ctrl.signal), TooSlow);
});

test("the cap refuses DURING the read, without accumulating the body", async () => {
  const ctrl = new AbortController();
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) { pulls++; c.enqueue(bytes(64)); },
  });
  await assert.rejects(() => readBounded(body, 128, ctrl.signal), TooLarge);
  // Three 64-byte chunks is all it took to pass a 128-byte ceiling; a reader
  // that buffered first would have gone on pulling.
  assert.ok(pulls <= 4, `stopped at the cap, pulled ${pulls}`);
});

test("an upload inside both bounds comes back whole", async () => {
  const ctrl = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(bytes(3)); c.enqueue(bytes(4)); c.close(); },
  });
  const out = await readBounded(body, 1024, ctrl.signal);
  assert.equal(out.byteLength, 7);
  assert.deepEqual([...out], [7, 7, 7, 7, 7, 7, 7]);
});
