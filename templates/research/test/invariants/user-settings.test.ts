import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "effection";
import { fileSettingsStore, USER_SETTINGS_FILE, type UserSettings } from "../../src/user/store.js";

const folder = (): string => mkdtempSync(join(tmpdir(), "harness-user-"));

const settings: UserSettings = {
  version: 1,
  transcription: { entries: [{ term: "lloyal", heardAs: ["loyal"] }, { term: "Kazim" }] },
};

test("a missing file reads as empty settings and the first write makes it", async () => {
  const root = folder();
  const store = fileSettingsStore(root);
  assert.deepEqual(await run(() => store.read()), { version: 1, transcription: { entries: [] } });
  await run(() => store.set(settings));
  assert.deepEqual(JSON.parse(readFileSync(join(root, USER_SETTINGS_FILE), "utf8")), settings);
});

test("a round trip keeps the order and the heard-as spellings", async () => {
  const root = folder();
  const store = fileSettingsStore(root);
  await run(() => store.set(settings));
  assert.deepEqual(await run(() => store.read()), settings);
});

test("a version this app does not know reads as empty and leaves the file alone", async () => {
  const root = folder();
  const kept = JSON.stringify({ version: 2, transcription: { entries: [{ term: "kept" }] } });
  writeFileSync(join(root, USER_SETTINGS_FILE), kept);
  const store = fileSettingsStore(root);
  assert.deepEqual(await run(() => store.read()), { version: 1, transcription: { entries: [] } });
  assert.equal(readFileSync(join(root, USER_SETTINGS_FILE), "utf8"), kept);
});

test("a file this app cannot read is reported once and starts empty", async () => {
  const root = folder();
  writeFileSync(join(root, USER_SETTINGS_FILE), "{ not json");
  const problems: string[] = [];
  const store = fileSettingsStore(root, { onProblem: (problem) => problems.push(problem) });
  assert.deepEqual(await run(() => store.read()), { version: 1, transcription: { entries: [] } });
  assert.equal(problems.length, 1);
});

test("a write leaves no half-written file beside it", async () => {
  const root = folder();
  const store = fileSettingsStore(root);
  await run(() => store.set(settings));
  assert.deepEqual(readdirSync(root), [USER_SETTINGS_FILE]);
});

test("an entry with no term is not a word, and the file is reported rather than half-read", async () => {
  const root = folder();
  writeFileSync(join(root, USER_SETTINGS_FILE), JSON.stringify({
    version: 1, transcription: { entries: [{ term: "  " }, { term: "lloyal" }] },
  }));
  const problems: string[] = [];
  const store = fileSettingsStore(root, { onProblem: (problem) => problems.push(problem) });
  assert.deepEqual(await run(() => store.read()), { version: 1, transcription: { entries: [] } });
  assert.equal(problems.length, 1);
});
