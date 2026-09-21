/**
 * What the model REMEMBERS, and when that can be trusted.
 *
 * Three facts have to agree after every turn: what is saved, what the reader was shown, and what the next
 * question continues from. They come apart at the edges — a turn that was stopped, one whose memory update
 * failed, a grouping running when a question arrives — and each of those is a path here.
 *
 * The rule the app holds: a record on disk is what a page IS, and the model's memory of it is a cache that any
 * interrupted turn invalidates. So memory is never restored, only rebuilt, and always from the page's own
 * record rather than from whichever folder is newest.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { runHarness, warmDeltas } from "./harness.js";
import type { WorkflowEvent } from "../../src/protocol.js";

const queries = (events: readonly WorkflowEvent[]) =>
  events.filter((e): e is Extract<WorkflowEvent, { type: "query" }> => e.type === "query");
const answers = (events: readonly WorkflowEvent[]) =>
  events.filter((e): e is Extract<WorkflowEvent, { type: "answer" }> => e.type === "answer").map((e) => e.text);
const shelves = (events: readonly WorkflowEvent[]) =>
  events.filter((e): e is Extract<WorkflowEvent, { type: "library" }> => e.type === "library");

const recordOf = (query: string) => ({ version: 1, query, savedAt: "2026-09-01T00:00:00.000Z", answer: "kept" });

function plant(root: string, name: string, record: unknown): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "article.md"), "# planted\n\nbody\n", "utf8");
  fs.writeFileSync(path.join(dir, "article.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

test("a question takes the model from the grouping rather than sharing it", async () => {
  // The grouping is model work like any other, so it goes through the one execution owner. If it ran beside a
  // turn instead, both would be talking to the same context: the scripted model hands out utterances in the
  // order they are asked for, so a classifier sampling mid-turn steals the angle's and the article comes back
  // wrong. There is no `topics` utterance here on purpose — the grouping must never get that far.
  const run = await runHarness({
    setup: (outputDir) => {
      plant(outputDir, "2026-09-01-a", recordOf("solid state batteries"));
      plant(outputDir, "2026-09-02-b", recordOf("lithium mining"));
    },
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
    ],
    script: [
      { send: { type: "submit_query", query: "what is a solid-state cell?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 3 },
    ],
  });

  assert.deepEqual(answers(run.events), ["## The article"], "the angles' utterances must not have been taken");
  const grouped = shelves(run.events).filter((s) => s.groups !== null);
  assert.equal(grouped.length, 0, "a grouping that reached the model would have consumed an angle's turn");
});

test("a stopped turn leaves the page, and the next question is still a follow-up", async () => {
  // `warm` is a fact about the PAGE, so it is read from the page. A trunk cannot answer it: `run.stop()`
  // returns before its cleanup finishes, so a trunk read at this moment may be mid-teardown.
  const run = await runHarness({
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
      { kind: "report", text: "Angle one, again." },
      { kind: "report", text: "Angle two, again." },
      { kind: "text", text: "## The article, extended" },
    ],
    script: [
      { send: { type: "submit_query", query: "what is the Antikythera mechanism?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 1 },
      { send: { type: "submit_query", query: "who built it?" } },
      { send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted" },
      { send: { type: "submit_query", query: "when was it found?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
    ],
  });

  const asked = queries(run.events);
  assert.equal(asked.length, 3);
  assert.equal(asked[0].warm, false, "the first question has no page to extend");
  assert.equal(asked[2].warm, true, "a stopped turn does not take the page with it");
});

test("after a stop, memory is rebuilt from the record rather than trusted", async () => {
  // A stopped turn may have committed a pair nobody was shown. The next question therefore cannot continue
  // from whatever the trunk happens to hold: it releases it and rebuilds from the page's own record, which is
  // the only thing that was ever shown to a reader.
  const run = await runHarness({
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
      { kind: "report", text: "Angle one, again." },
      { kind: "report", text: "Angle two, again." },
      { kind: "text", text: "## The article, extended" },
    ],
    script: [
      { send: { type: "submit_query", query: "what is the Antikythera mechanism?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 1 },
      { send: { type: "submit_query", query: "who built it?" } },
      { send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted" },
      { send: { type: "submit_query", query: "when was it found?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
    ],
  });

  // Two settled turns commit; the interrupted one must not leave a commit the reader never saw standing as
  // the page. A rebuild is itself a commit, so the third turn's own is on top of one it made from the record.
  assert.ok(
    warmDeltas(run.trace).length >= 3,
    "the third question must rebuild the page from its record before extending it",
  );
  assert.deepEqual(
    answers(run.events).filter((a) => a !== null),
    ["## The article", "## The article, extended"],
    "the stopped turn contributes no answer, and the one after it extends the page that was shown",
  );
});

test("the page a session extends is the record it saved, not the newest folder", async () => {
  // Someone else's article, planted with a LATER name than anything this session writes, so "newest folder"
  // and "this session's page" disagree and only one of them is right.
  //
  // The interruption has to reach a turn that is still RUNNING: a stop after one has finished is a no-op, so a
  // script that waits for the shelf first leaves memory trusted and the rebuild never happens. What is asserted
  // is the restoration itself — the query and answer it put back — because the scripted reply text is the same
  // whichever record the model was handed, and so cannot tell them apart.
  const STRANGER = "an article from another session";
  const run = await runHarness({
    setup: (outputDir) => plant(outputDir, "2099-01-01-elsewhere", recordOf(STRANGER)),
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
      { kind: "report", text: "Angle one, again." },
      { kind: "report", text: "Angle two, again." },
      { kind: "text", text: "## The article, extended" },
      { kind: "report", text: "Angle one, third." },
      { kind: "report", text: "Angle two, third." },
      { kind: "text", text: "## The article, third" },
    ],
    script: [
      { send: { type: "submit_query", query: "what is the Antikythera mechanism?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
      { send: { type: "submit_query", query: "who built it?" } },
      { send: { type: "stop" } },   // lands mid-turn, so memory is no longer trusted
      { on: (ev) => ev.type === "run:aborted" },
      { send: { type: "submit_query", query: "when was it found?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 3 },
    ],
  });

  const commits = warmDeltas(run.trace).map((t) => t.content ?? "");
  const restored = commits.filter((c) => c.includes("what is the Antikythera mechanism?"));
  assert.ok(
    restored.length >= 2,
    `the page had to be put back before it could be extended — commits: ${JSON.stringify(commits)}`,
  );
  assert.ok(
    restored.some((c) => c.includes("## The article")),
    "the restoration must carry the answer this session actually saved",
  );
  assert.equal(
    commits.filter((c) => c.includes(STRANGER)).length,
    0,
    "a stranger's record is on disk and is newer; nothing may rebuild from it",
  );
});

// ── when the parts that can fail, fail ──────────────────────────────────────
//
// Saving and remembering are the two things a turn does after the model has spoken, and each can fail on its
// own. What must hold either way: nothing is published that was not saved, nothing is remembered that was not
// published, and the next question continues from whatever the reader last actually saw.

/**
 * Take the library away and give it back, by putting a FILE where the folder was.
 *
 * `mkdirSync` refuses a path whose parent is a file, on every platform. Permissions do not work here: a
 * read-only bit is not honoured for DIRECTORIES on Windows, and these tests ship inside every scaffold, so
 * they have to fail the same way wherever a reader runs them.
 *
 * The folder is moved aside rather than removed, so whatever is already saved survives being given back.
 */
const ASIDE = ".aside";
const takeLibrary = (dir: string): void => {
  fs.renameSync(dir, dir + ASIDE);
  fs.writeFileSync(dir, "", "utf8");
};
const giveLibraryBack = (dir: string): void => {
  fs.rmSync(dir);
  fs.renameSync(dir + ASIDE, dir);
};

const TURN = [
  { kind: "report" as const, text: "Angle one." },
  { kind: "report" as const, text: "Angle two." },
  { kind: "text" as const, text: "## The article" },
];
const AGAIN = [
  { kind: "report" as const, text: "Angle one, again." },
  { kind: "report" as const, text: "Angle two, again." },
  { kind: "text" as const, text: "## The article, extended" },
];
const THIRD = [
  { kind: "report" as const, text: "Angle one, third." },
  { kind: "report" as const, text: "Angle two, third." },
  { kind: "text" as const, text: "## The article, third" },
];

test("an article that cannot be saved is not published either", async () => {
  // Disk first is what makes this the safe failure: the record is written before the reader is told anything,
  // so a library that cannot be written costs the turn rather than leaving an article on screen that no
  // relaunch would find. The page is untouched, so the next question is still a cold one.
  let library = "";
  const run = await runHarness({
    utterances: [...TURN, ...AGAIN],
    setup: (outputDir) => { library = outputDir; },
    // On the QUESTION, not at setup: boot lists the library and the grouping reads it, so taking it away any
    // earlier would break the boot rather than the save this is about.
    observe: (ev) => {
      if (ev.type === "query" && ev.text.startsWith("what is")) takeLibrary(library);
      if (ev.type === "ui:error") giveLibraryBack(library);
    },
    script: [
      { send: { type: "submit_query", query: "what is the Antikythera mechanism?" } },
      { on: (ev) => ev.type === "ui:error" },
      { send: { type: "submit_query", query: "who built it?" } },
      { on: (ev) => ev.type === "query" && ev.text === "who built it?" },
    ],
  });

  assert.deepEqual(answers(run.events), [], "nothing may be published that was not saved");
  assert.deepEqual(
    fs.readdirSync(run.outputDir).filter((d) => fs.existsSync(path.join(run.outputDir, d, "article.json"))),
    [],
    "no record should have survived the failure",
  );
  assert.equal(queries(run.events)[1].warm, false, "there is no page, so the next question opens a new one");
});

test("a follow-up that cannot be saved leaves the article it failed to extend", async () => {
  // The first article is on disk and on screen. The second turn produces prose but cannot keep it, so it is
  // published nowhere and the page stays what it was — and because that turn died, memory is no longer trusted
  // and the question after it rebuilds the page from its record.
  let library = "";
  const run = await runHarness({
    utterances: [...TURN, ...AGAIN, ...THIRD],
    setup: (outputDir) => { library = outputDir; },
    observe: (ev) => {
      // Take the library away as the follow-up is asked, and give it back when that turn has died — so the
      // question after it is a normal one, failing at nothing.
      if (ev.type === "query" && ev.text === "who built it?") takeLibrary(library);
      if (ev.type === "run:aborted") giveLibraryBack(library);
    },
    script: [
      { send: { type: "submit_query", query: "what is the Antikythera mechanism?" } },
      { on: (ev) => ev.type === "library" && ev.articles.length === 1 },
      { send: { type: "submit_query", query: "who built it?" } },
      { on: (ev) => ev.type === "ui:error" },
      { send: { type: "submit_query", query: "when was it found?" } },
      // The shelf is the whole turn being over, so this waits for the rebuild rather than racing it.
      { on: (ev) => ev.type === "library" && ev.articles.length === 2 },
    ],
  });

  assert.deepEqual(
    answers(run.events).filter((a) => a !== null),
    ["## The article", "## The article, third"],
    "the follow-up could not be kept, so it is not an answer; the question after it is unaffected",
  );
  assert.equal(queries(run.events)[2].warm, true, "the page it failed to extend is still the page");
  const restored = warmDeltas(run.trace)
    .map((t) => t.content ?? "")
    .filter((c) => c.includes("what is the Antikythera mechanism?"));
  assert.ok(restored.length >= 2, "the dead turn left memory untrusted, so the page is put back from its record");
});

// One path is absent: an article that saves but whose memory update then fails. Reaching it means failing a
// native call, which a harness has no vocabulary for — see lloyal-ai#44. The ordering that makes it safe is
// legible in `article.ts` instead: the record and the reader both come first.
