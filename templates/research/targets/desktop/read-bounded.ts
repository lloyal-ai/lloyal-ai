/**
 * Reading an upload under a ceiling and a deadline.
 *
 * Nothing here knows about Electron or the content plane — it is a stream, a
 * cap and a signal — which is what lets it be tested against a stalled stream
 * instead of a three-minute wait.
 */

/** Over the cap. Separate from a refusal so the client is told which limit. */
export class TooLarge extends Error {}
/** Past the deadline — the transfer, the ingest, or both together. */
export class TooSlow extends Error {}

/**
 * Read the body, refusing AT the cap rather than after it, and giving up the
 * moment the signal says so.
 *
 * The abort is RACED against each read rather than checked between them.
 * Checking `signal.aborted` at the top of the loop only ever runs when a read
 * resolves, and a stalled stream is precisely the case where none does — the
 * deadline would fire into nothing and the request would hang for as long as
 * the producer stayed silent.
 *
 * Cancellation is started, never awaited: on a stream whose `read()` is stuck,
 * `cancel()` can be stuck too, so waiting on it would reintroduce the hang it
 * exists to end.
 */
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  // An already-aborted signal fires no `abort` event; a listener would wait
  // for something that has been and gone.
  if (signal.aborted) throw new TooSlow("the upload was cancelled");
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  let reject!: (e: Error) => void;
  const cancelled = new Promise<never>((_, rej) => { reject = rej; });
  const abort = (): void => reject(new TooSlow("the upload was cancelled"));
  signal.addEventListener("abort", abort, { once: true });

  const chunks: Uint8Array[] = [];
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), cancelled]);
      if (done) break;
      seen += value.byteLength;
      if (seen > cap) throw new TooLarge(`upload exceeds ${cap} bytes`);
      chunks.push(value);
    }
    // Reaching EOF is not safety: the deadline can pass as the last chunk
    // lands, and the bytes would go on to be ingested for nobody.
    if (signal.aborted) throw new TooSlow("the upload was cancelled");
  } catch (err) {
    void reader.cancel().catch(() => {});
    throw err;
  } finally {
    signal.removeEventListener("abort", abort);
  }

  const out = new Uint8Array(seen);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
