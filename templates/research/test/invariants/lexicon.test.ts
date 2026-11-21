import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "effection";
import { openLexicon, replace } from "../../src/user/lexicon.js";
import type { SettingsStore, UserSettings } from "../../src/user/store.js";
import type { LexiconEntry } from "../../src/protocol.js";

const words: LexiconEntry[] = [
  { term: "lloyal", heardAs: ["loyal", "l oil"] },
  { term: "Kazim", heardAs: ["kazem"] },
];

test("a heard spelling is replaced by the term, and only as a whole word", () => {
  assert.equal(replace(words, "a loyal friend").text, "a lloyal friend");
  assert.equal(replace(words, "a loyalty scheme").text, "a loyalty scheme");
});

test("the term's own spelling is what lands, whatever the heard spelling's case", () => {
  assert.equal(replace(words, "Loyal friends").text, "lloyal friends");
  assert.equal(replace(words, "kazem said so").text, "Kazim said so");
});

test("a phrase of two words is replaced as one", () => {
  assert.equal(replace(words, "an l oil moment").text, "an lloyal moment");
});

test("a term with no heard spellings changes nothing", () => {
  assert.equal(replace([{ term: "Parrot" }], "a parrot").text, "a parrot");
});

test("the count says how many places changed", () => {
  assert.equal(replace(words, "loyal and loyal").replaced, 2);
  assert.equal(replace(words, "nothing here").replaced, 0);
});

/** A store that keeps the document in memory: what the file store does, without a file. */
const memory = (): SettingsStore & { current(): UserSettings } => {
  let settings: UserSettings = { version: 1, transcription: { entries: [] } };
  return {
    *read() { return settings; },
    *set(next) { settings = next; },
    current: () => settings,
  };
};

test("adding a word keeps its place and merges the spellings it was heard as", async () => {
  const store = memory();
  await run(function* () {
    const words = yield* openLexicon(store);
    yield* words.add("lloyal", ["loyal"]);
    yield* words.add("lloyal", ["l oil", "loyal"]);
    yield* words.add("Kazim");
    assert.deepEqual(words.entries(), [
      { term: "lloyal", heardAs: ["loyal", "l oil"] },
      { term: "Kazim" },
    ]);
  });
  assert.deepEqual(store.current().transcription.entries, [
    { term: "lloyal", heardAs: ["loyal", "l oil"] },
    { term: "Kazim" },
  ]);
});

test("removing a word forgets it, whatever its case", async () => {
  const store = memory();
  await run(function* () {
    const words = yield* openLexicon(store);
    yield* words.add("lloyal");
    yield* words.remove("LLOYAL");
    assert.deepEqual(words.entries(), []);
  });
});

test("an empty term is refused, so a stray Enter adds nothing", async () => {
  const store = memory();
  await run(function* () {
    const words = yield* openLexicon(store);
    yield* words.add("   ");
    assert.deepEqual(words.entries(), []);
  });
});
