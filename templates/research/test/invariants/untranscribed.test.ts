/**
 * A video whose soundtrack could not all be transcribed is still attached:
 * the frames and the speech that was heard reach the model. What did not is
 * said on the attachment before the question is sent, never left to look
 * like a fully transcribed video.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { untranscribedNotice } from "../../src/ui/presentation.js";

const lost = (startMs: number, endMs: number) => ({ startMs, endMs, reason: "the service failed" });

test("a fully transcribed video says nothing", () => {
  assert.equal(untranscribedNotice([]), null);
});

test("each stretch the model will not hear is named by its time", () => {
  assert.equal(untranscribedNotice([lost(5_000, 10_000)]), "The model won't hear the speech from 0:05 to 0:10.");
  assert.equal(untranscribedNotice([lost(5_000, 10_000), lost(65_000, 70_000)]),
    "The model won't hear the speech from 0:05 to 0:10 and 1:05 to 1:10.");
});

test("many stretches are counted, not listed", () => {
  const many = [0, 1, 2, 3, 4].map((i) => lost(i * 5_000, (i + 1) * 5_000));
  assert.equal(untranscribedNotice(many), "The model won't hear the speech in 5 parts of this video, from 0:00 to 0:25.");
});
