import { test } from "node:test";
import assert from "node:assert/strict";
import { Services } from "@lloyal-labs/rig";
import type { VoiceResult } from "@lloyal-labs/binding";
import { harness } from "../../src/app.js";
import { initialState, reduce } from "../../src/ui/state.js";
import { runHarness, warmDeltas } from "./harness.js";

/** A content root the way a browser hands one in: a descriptor it claims is an attachment. The store that would
 *  vouch for the claim is no part of this scenario, so it stands as given. */
const audio = { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: `sha256:${"a".repeat(64)}`, size: 10 } as VoiceResult["audio"];
const result: VoiceResult = {
  text: "A dictated question", audio,
  representation: { mediaType: "audio/wav", digest: `sha256:${"b".repeat(64)}`, size: 44 },
  durationSeconds: 1, silent: false,
  provenance: { model: "test", projector: "test", sampleRate: 16000, context: 4096, maxTokens: 512 },
};

/** The app's own composition over a transcriber that answers at once. The bounds are what a recording would be
 *  admitted against; this double never reads them. */
const withTranscription: typeof harness = function* (ctx, events, commands) {
  yield* Services.set({
    ...yield* Services.expect(),
    transcription: {
      limits: { maxBytes: 16 * 1024 * 1024, maxDurationSeconds: 120, maxChannels: 2, maxSampleRate: 48000 },
      *transcribe() { return result; },
    },
  });
  yield* harness(ctx, events, commands);
};

test("dictation returns editable text without starting a turn", async () => {
  const run = await runHarness({
    harness: withTranscription,
    script: [
      { send: { type: "voice:describe" } },
      { on: ev => ev.type === "voice:capabilities", send: { type: "voice:transcribe", requestId: "draft", audio } },
      { on: ev => ev.type === "voice:result" },
    ],
  });
  assert.ok(run.events.some(ev => ev.type === "voice:capabilities" && ev.capabilities.enabled));
  assert.deepEqual(run.events.find(ev => ev.type === "voice:result"), { type: "voice:result", requestId: "draft", result });
  assert.equal(run.events.some(ev => ev.type === "query"), false);
  assert.equal(warmDeltas(run.trace).length, 0);
  assert.equal(reduce(initialState, { type: "voice:result", requestId: "draft", result }), initialState);
});
