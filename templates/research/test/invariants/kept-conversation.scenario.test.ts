/**
 * A warm turn is written on a fork of the trunk, and a failure prunes only the fork. The brief keeps the
 * conversation: the next ask threads the same trunk, with everything the earlier turns attended — the brief's
 * images and videos included — instead of disposing it and rebuilding a text-only copy from the library.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FileAttachmentStore } from "@lloyal-labs/media/node";
import type { Attachment } from "@lloyal-labs/media";
import type { MockSessionContext } from "@lloyal-labs/sdk/testing";
import { runHarness, docIdOfQuery, sessionReleasesOf, warmDeltas } from "./harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const png = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(here, "../fixtures/video", name)));

/** Two pictures in a content store: one for the question that starts the brief, one for the ask that fails. */
function plant(): { store: FileAttachmentStore; first: Attachment; second: Attachment } {
  const store = new FileAttachmentStore(fs.mkdtempSync(path.join(os.tmpdir(), "kept-scn-")));
  const picture = (name: string): Attachment => store.putAttachment({ representations: [store.putBlob(png(name), "image/png")] });
  return { store, first: picture("frame-00.png"), second: picture("frame-01.png") };
}

test("a warm turn whose prefill fails loses only its fork: the next ask threads the same trunk, the first picture still on it", async () => {
  const { store, first, second } = plant();
  let ctx!: MockSessionContext;
  let projections = 0;
  const run = await runHarness({
    attachmentStore: store,
    instrument: (c) => {
      ctx = c;
      // The second projection is the warm turn's, on a fork of the trunk; the first (the brief's own picture) lands.
      c.mockMultimodalError = () => (++projections === 2 ? { message: "compute failed", rc: -3, partial: false } : null);
    },
    utterances: [
      { text: "The first picture shows a square.", kind: "text" },
      { text: "never reached", kind: "text" },
      { text: "Still the square from the first picture.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "What is in the picture?", mode: "flat", skipPlanner: true, attachments: [first] } },
      { on: (ev) => ev.type === "complete", send: { type: "submit_query", query: "And this one?", mode: "flat", skipPlanner: true, attachments: [second] } },
      // The toast is the failed run's last word; the next ask comes after it, as a reader's would.
      { on: (ev) => ev.type === "ui:error", send: { type: "submit_query", query: "What did the first picture show?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  // The failed ask: one toast, the run aborted, nothing kept of it.
  const errors = run.events.filter((e) => e.type === "ui:error") as { message: string }[];
  assert.equal(errors.length, 1, `one toast for the failed turn: ${run.events.map((e) => e.type).join(" ")}`);
  assert.match(errors[0].message, /compute failed/);
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 1);

  // The trunk: one brief, one trunk, never released before shutdown; the third ask's turn is a delta on it.
  const deltas = warmDeltas(run.trace);
  assert.ok(deltas.length >= 2, `the brief and the third ask each committed a turn: ${deltas.length}`);
  const trunk = deltas[0].branchHandle!;
  assert.equal(deltas[deltas.length - 1].branchHandle, trunk, "the third ask threaded the same trunk");
  assert.equal(sessionReleasesOf(run, trunk).length, 0, "the trunk was not disposed and rebuilt from the library");
  assert.equal(ctx.multimodalPrefills.length, 2, "the first picture was projected once and never re-read: a rebuild would have been text only");

  // The thread on disk: the brief and the one exchange that completed.
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  assert.equal(fs.readdirSync(dir).filter((f) => /^exchange-\d+\.md$/.test(f)).length, 1, "the failed ask left no exchange; the third ask did");
});
