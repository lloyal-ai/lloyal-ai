import { test } from "node:test";
import assert from "node:assert/strict";
import { Services } from "@lloyal-labs/rig";
import { asAttachment, DEFAULT_AUDIO_ADMISSION, MANIFEST_TYPE } from "@lloyal-labs/media";
import type { VoiceResult } from "@lloyal-labs/binding";
import { harness } from "../../src/app.js";
import { initialState, reduce } from "../../src/ui/state.js";
import { runHarness, warmDeltas } from "./harness.js";

const audio = asAttachment({ mediaType: MANIFEST_TYPE, digest: `sha256:${"a".repeat(64)}`, size: 10 })!;
const result: VoiceResult = {
  text: "A dictated question", audio,
  representation: { mediaType: "audio/wav", digest: `sha256:${"b".repeat(64)}`, size: 44 },
  durationSeconds: 1, silent: false,
  provenance: { model: "test", projector: "test", sampleRate: 16000, context: 4096, maxTokens: 512 },
};

const withTranscription: typeof harness = function* (ctx, events, commands) {
  yield* Services.set({
    ...yield* Services.expect(),
    transcription: { limits: DEFAULT_AUDIO_ADMISSION, *transcribe() { return result; } },
  });
  yield* harness(ctx, events, commands);
};

test("dictation returns editable text without starting research or committing a turn", async () => {
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
  assert.equal(run.events.some(ev => ev.type === "query" || ev.type === "research:start"), false);
  assert.equal(warmDeltas(run.trace).length, 0);
  assert.equal(reduce(initialState, { type: "voice:result", requestId: "draft", result }), initialState);
});

test("an unconfigured transcription service hides voice controls", async () => {
  const run = await runHarness({
    config: { model: { transcription: "" } },
    script: [{ send: { type: "voice:describe" } }, { on: ev => ev.type === "voice:capabilities" }],
  });
  assert.deepEqual(run.events.find(ev => ev.type === "voice:capabilities"), { type: "voice:capabilities", capabilities: { enabled: false } });
});

test("a refused recording stays a voice error and leaves the harness responsive", async () => {
  const run = await runHarness({
    script: [
      { send: { type: "voice:transcribe", requestId: "bad", audio: { ...audio, mediaType: "audio/wav" } } },
      { on: ev => ev.type === "voice:error", send: { type: "library_list" } },
      { on: ev => ev.type === "library:list" },
    ],
  });
  assert.ok(run.events.some(ev => ev.type === "voice:error" && ev.requestId === "bad"));
  assert.equal(run.events.some(ev => ev.type === "run:aborted" || ev.type === "query"), false);
});
