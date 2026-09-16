/**
 * A disconnect during a trunk decode: the context is disposed only once the
 * decode has settled, and nothing runs past the halted call.
 *
 * The harness awaits the Session's native calls — the trunk prefill an attached
 * image rides in on, the turn commits, the reranker scores — through
 * `waitUntilSettled`. A bare `call(() => …)` would let a halt (the host
 * releasing a disconnected session) abandon the promise: the harness scope
 * unwinds, `initAgents`' cleanup disposes the context, and the native batch is
 * still writing it (the 2026-09-12 release review, R2). This drives the REAL
 * harness over the mock context, holds the trunk's image prefill, halts the
 * scope that owns the context from inside the hold, and reads the mock's
 * dispose count on both sides of the release. Reverting the prefill site to
 * `call` turns it red: the halt would resolve during the hold, with the
 * context already disposed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileAttachmentStore } from "@lloyal-labs/media/node";
import type { Attachment } from "@lloyal-labs/media";
import type { MockSessionContext } from "@lloyal-labs/sdk/testing";
import { runHarness } from "./harness.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function plantImage(): { store: FileAttachmentStore; image: Attachment } {
  const store = new FileAttachmentStore(fs.mkdtempSync(path.join(os.tmpdir(), "lifetime-scn-")));
  return { store, image: store.putAttachment({ representations: [store.putBlob(PNG, "image/png")] }) };
}

test("a disconnect during the trunk's image prefill: the decode settles before the context is disposed, and nothing runs after", async () => {
  const { store, image } = plantImage();
  let halt!: () => Promise<void>;
  let ctx!: MockSessionContext;
  const seen = { disposedDuringHold: -1, haltSettledDuringHold: true };
  const run = await runHarness({
    attachmentStore: store,
    controls: (c) => { halt = c.halt; },
    instrument: (c) => {
      ctx = c;
      const inner = c._storePrefillMultimodal.bind(c);
      let held = false;
      c._storePrefillMultimodal = async (...args: Parameters<typeof inner>) => {
        if (!held) {
          held = true;
          // A disconnect arrives from the event loop, never from inside the
          // fiber's own synchronous prologue: this call is still evaluating
          // the argument of `yield* waitUntilSettled(...)`. One macrotask lets
          // the fiber reach the barrier, where a real disconnect always finds it.
          await new Promise<void>((r) => setImmediate(r));
          let haltSettled = false;
          const halting = halt();
          halting.then(() => { haltSettled = true; }, () => { haltSettled = true; });
          // Give a lost halt every chance to show itself: an abandoned promise
          // lets teardown run at once, and the context is disposed within a
          // tick. The hold outlasts that by a wide margin.
          await new Promise<void>((r) => setTimeout(r, 25));
          seen.disposedDuringHold = c.disposeCount;
          seen.haltSettledDuringHold = haltSettled;
        }
        return inner(...args);
      };
    },
    script: [
      { send: { type: "submit_query", query: "What is in the picture?", mode: "flat", skipPlanner: true, attachments: [image] } },
      { on: () => false },   // never satisfied: the halt ends this run, not `quit`
    ],
  });

  assert.equal(run.halted, true, "the scenario's halt ended the run");
  assert.equal(seen.disposedDuringHold, 0, "the context was disposed while the decode was still in flight");
  assert.equal(seen.haltSettledDuringHold, false, "the halt resolved before the decode settled");
  // The harness owns the session; the context is the boot's (or the host's) and is not disposed here.
  assert.equal(ctx.disposeCount, 0, "the harness never disposes the context it was handed");
  // Nothing past the halted call: no run began, no error toast, no answer.
  const after = run.events.map((e) => e.type).filter((t) => /^(plan|research|spine|agent|answer|complete|ui:error)/.test(t));
  assert.deepEqual(after, [], "the harness carried on past the halted call");
});
