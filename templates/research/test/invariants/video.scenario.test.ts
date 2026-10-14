/**
 * A video on the question: projected once, on the trunk, as ONE video input;
 * the question names the video's address so a report can cite a moment in it;
 * and that citation resolves to the video among the brief's roots. A clip that
 * would fill more of the context than the budget allows is refused before
 * anything is read in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FileAttachmentStore } from "@lloyal-labs/media/node";
import { composeVideo, parseAttachmentMoment, resolvePrefix } from "@lloyal-labs/media";
import type { Attachment } from "@lloyal-labs/media";
import type { MockSessionContext } from "@lloyal-labs/sdk/testing";
import { runHarness } from "./harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const frame = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(here, "../fixtures/video", name)));

async function plant(): Promise<{ store: FileAttachmentStore; video: Attachment }> {
  const store = new FileAttachmentStore(fs.mkdtempSync(path.join(os.tmpdir(), "video-scn-")));
  const frames = ["frame-00.png", "frame-01.png", "frame-02.png"].map((name, i) => ({
    root: store.putAttachment({ representations: [store.putBlob(frame(name), "image/png")] }),
    tMs: i * 250,
  }));
  const video = await composeVideo(store, {
    frames, sampling: { fps: 4, timestampIntervalMs: 5000, maxFrames: 64 }, durationMs: 1000,
    transcript: { provenance: { model: "test" }, segments: [{ startMs: 0, endMs: 1000, text: "one, two, three" }] },
  });
  return { store, video };
}

test("a video on the question is one video input on the trunk, and a moment cited in it resolves", async () => {
  const { store, video } = await plant();
  const prefix = video.digest.replace(/^sha256:/, "").slice(0, 12);
  const cite = `attachment://${prefix}/t/0m0.25s`;
  let ctx!: MockSessionContext;
  const run = await runHarness({
    attachmentStore: store,
    instrument: (c) => { ctx = c; },
    utterances: [{ text: `The square moves right [the clip](${cite}).`, kind: "report" as const }],
    script: [
      { send: { type: "submit_query", query: "Which way does the square move?", mode: "flat", skipPlanner: true, attachments: [video] } },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  assert.equal(run.events.filter((e) => e.type === "ui:error").length, 0);
  assert.equal(ctx.multimodalPrefills.length, 1, "one projection");
  assert.deepEqual(ctx.multimodalPrefills[0].inputKinds, [["video"]], "the clip is one video input, not three images");
  assert.ok(ctx.multimodalPrefills[0].prompts[0].includes(`Video 1 is attachment://${prefix}; cite a moment in it as attachment://${prefix}/t/ followed by the time the video marks, such as attachment://${prefix}/t/0m5.00s.`),
    "the question names the video's address");

  // Resolved as the view resolves it: against the roots the brief's query event carries.
  const query = run.events.find((e) => e.type === "query") as { attachments?: Attachment[] } | undefined;
  const roots = (query?.attachments ?? []).map((a) => a.digest);
  const moment = parseAttachmentMoment(cite)!;
  assert.equal(resolvePrefix(moment.prefix, roots), video.digest, "the cited moment resolves to the video among the brief's roots");
  assert.equal(moment.tMs, 250);
});

test("a video that would fill more of the context than the budget allows is refused before any prefill", async () => {
  const { store, video } = await plant();
  let ctx!: MockSessionContext;
  const run = await runHarness({
    attachmentStore: store,
    // Every frame priced at the whole context: the clip cannot fit the share the budget gives attachments.
    instrument: (c) => { ctx = c; c.mockImageCells = c.nCtx; },
    script: [
      { send: { type: "submit_query", query: "Which way does the square move?", mode: "flat", skipPlanner: true, attachments: [video] } },
      { on: (ev) => ev.type === "ui:error" },
    ],
  });

  const errors = run.events.filter((e) => e.type === "ui:error") as { message: string }[];
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /would take [\d,]+ of the [\d,]+-token context; this harness lets attachments fill up to 50% of it/);
  assert.equal(ctx.multimodalPrefills.length, 0, "nothing was read in");
});
