import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Services } from "@lloyal-labs/rig";
import { asAttachment, DEFAULT_AUDIO_ADMISSION, MANIFEST_TYPE } from "@lloyal-labs/media";
import type { TranscriptBias, VoiceResult } from "@lloyal-labs/binding";
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

/** A transcriber that says the app's words reached it and returns the text the ASR "heard". */
const withLexicon = (text: string) => {
  const heard: (TranscriptBias | undefined)[] = [];
  const composed: typeof harness = function* (ctx, events, commands) {
    yield* Services.set({
      ...(yield* Services.expect()),
      transcription: {
        limits: DEFAULT_AUDIO_ADMISSION, bias: "prompt",
        *transcribe(_audio, bias) { heard.push(bias); return { ...result, text }; },
      },
    });
    yield* harness(ctx, events, commands);
  };
  return { harness: composed, heard };
};

const withTranscription: typeof harness = function* (ctx, events, commands) {
  yield* Services.set({
    ...(yield* Services.expect()),
    transcription: { limits: DEFAULT_AUDIO_ADMISSION, bias: "prompt", *transcribe() { return result; } },
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
  assert.deepEqual(run.events.find(ev => ev.type === "voice:result"), {
    type: "voice:result", requestId: "draft", result: { ...result, rawText: result.text },
  });
  assert.equal(run.events.some(ev => ev.type === "query" || ev.type === "research:start"), false);
  assert.equal(warmDeltas(run.trace).length, 0);
  assert.equal(reduce(initialState, { type: "voice:result", requestId: "draft", result }), initialState);
});

test("the reader's words reach the transcriber and the replacement is what the reader gets", async () => {
  const fake = withLexicon("A loyal friend");
  const run = await runHarness({
    setup: (outputDir) => writeFileSync(join(outputDir, "user.json"), JSON.stringify({
      version: 1, transcription: { entries: [{ term: "lloyal", heardAs: ["loyal"] }] },
    })),
    harness: fake.harness,
    script: [
      { send: { type: "voice:describe" } },
      { on: ev => ev.type === "voice:capabilities", send: { type: "voice:transcribe", requestId: "draft", audio } },
      { on: ev => ev.type === "voice:result" },
    ],
  });
  assert.deepEqual(fake.heard, [{ terms: ["lloyal"], strength: "hint" }]);
  const said = run.events.find(ev => ev.type === "voice:result");
  assert.equal(said?.result.text, "A lloyal friend");
  assert.equal(said?.result.rawText, "A loyal friend");
  assert.ok(run.events.some(ev => ev.type === "voice:capabilities" && ev.capabilities.enabled && ev.capabilities.bias === "prompt"));
});

test("the lexicon reaches the window as a session fact", async () => {
  const run = await runHarness({
    setup: (outputDir) => writeFileSync(join(outputDir, "user.json"), JSON.stringify({
      version: 1, transcription: { entries: [{ term: "lloyal", heardAs: ["loyal"] }] },
    })),
    harness: withTranscription,
    script: [{ send: { type: "library_list" } }, { on: ev => ev.type === "library:list" }],
  });
  const said = run.events.find(ev => ev.type === "lexicon:state");
  assert.deepEqual(said?.entries, [{ term: "lloyal", heardAs: ["loyal"] }]);
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

test("the lexicon folds into the session, and a later state replaces it whole", () => {
  const first = reduce(initialState, { type: "lexicon:state", entries: [{ term: "lloyal", heardAs: ["loyal"] }] });
  assert.deepEqual(first.session.lexicon, [{ term: "lloyal", heardAs: ["loyal"] }]);
  assert.deepEqual(reduce(first, { type: "lexicon:state", entries: [] }).session.lexicon, []);
});
