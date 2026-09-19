/**
 * The library on its own. A brief's record (`report.json`) is the ONE file it reads back — the markdown beside
 * it is for readers and the corpus — and the record is written last, so a folder whose record is missing was
 * never settled. Its reads are confined (a planted symlink named like an exchange must not pull a file from
 * outside the folder onto the wire), the run record is shared by every session on a brief, so a file name is a
 * reservation, and the roots a tool admitted ride the record once each.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import fsModule from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { run, createChannel } from "effection";
import type { Operation } from "effection";
import { createBus } from "@lloyal-labs/binding";
import type { EventBus } from "@lloyal-labs/binding";
import { Attachments } from "@lloyal-labs/lloyal-agents";
import { NullAttachmentStore } from "@lloyal-labs/media";
import { createAbilityRegistry, createInMemoryConfigStore } from "@lloyal-labs/rig";
import { asBriefRecord, openLibrary, writeBrief } from "../../src/brief/library.js";
import type { BriefRecord, Library } from "../../src/brief/library.js";
import type { WorkflowEvent } from "../../src/brief/protocol.js";
import type { Inputs, Written } from "../../src/research/research.js";

const ev = (e: Record<string, unknown>): WorkflowEvent => e as unknown as WorkflowEvent;
const ask = (docId: string, attachments: { digest: string }[] = []): Inputs =>
  ({ docId, text: "Q?", mode: "flat", direct: false, effort: "low", attachments, excluded: [], sources: [] }) as unknown as Inputs;

/** What a writer hands back: the answer, and what each inquiry found, in plan order. */
const wrote = (inquiries: { task: string; findings: string }[], answer = "the answer"): Written =>
  ({ answer, inquiries, stats: { ctxPct: 0, ctxPos: 0, ctxTotal: 1 }, complete: {} });

/** A settled brief's record, as planted. */
const settled = (query: string, answer: string, extra: Partial<BriefRecord> = {}): BriefRecord =>
  ({ version: 1, query, savedAt: "2026-01-01T00:00:00.000Z", mode: "flat", effort: "low", direct: false, attachments: [], answer, inquiries: [], elapsedMs: 1000, ...extra });

/** One session's library over `dir`, with the bus it reads. */
function* opened(dir: string): Operation<{ lib: Library; bus: EventBus<WorkflowEvent> }> {
  const registry = yield* createAbilityRegistry({ configStore: createInMemoryConfigStore() });
  const bus = createBus<WorkflowEvent>();
  bus.subscribe(() => {});
  yield* Attachments.set(new NullAttachmentStore());
  const lib = yield* openLibrary(() => dir, { events: bus, registry, wire: createChannel<WorkflowEvent, void>(), run: { busy: false } as never, abilities: [] });
  return { lib, bus };
}

const fresh = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));

/** One run's evidence, written into a fresh library from what its writer returned. */
async function recorded(inquiries: { task: string; findings: string }[], complete: Written["complete"] = {}): Promise<{ dir: string; files: string[]; record: BriefRecord; report: string }> {
  const lib = fresh();
  const id = await run(function* () {
    const { lib: library, bus } = yield* opened(lib);
    const docId = library.reserve();
    library.begin(docId, ask(docId), { warm: false });
    library.written(docId, { ...wrote(inquiries), complete });
    bus.send(ev({ type: "complete", data: {} }));   // the record lands as `complete` is said
    yield* library.settled(docId);
    return docId;
  });
  const dir = path.join(lib, id);
  return {
    dir,
    files: fs.readdirSync(dir).filter((n) => /^annexure-\d+\.md$/.test(n)).sort(),
    record: asBriefRecord(fs.readFileSync(path.join(dir, "report.json"), "utf8"))!,
    report: fs.readFileSync(path.join(dir, "report.md"), "utf8"),
  };
}

test("a settled brief round-trips through its record alone: no markdown is opened to list or read it", async () => {
  const lib = fresh();
  const id = "2026-01-01T00-00-00-000";
  fs.mkdirSync(path.join(lib, id));
  writeBrief(path.join(lib, id), settled("Q?", "The body.", { effort: "ultra", direct: true, attachments: ["sha256:" + "a".repeat(64)] }), { exchange: false, annexuresFrom: 0 });
  writeBrief(path.join(lib, id), settled("Follow-up?", "The follow-up body."), { exchange: true, annexuresFrom: 0 });
  // Every file the library opens, by name: the builtin's export is replaced and the ESM bindings re-synced, so
  // the library's own `fs.readFileSync` is the spy.
  const opened_ = new Set<string>();
  const readFileSync = fsModule.readFileSync;
  fsModule.readFileSync = ((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (typeof file === "string") opened_.add(path.basename(file));
    return (readFileSync as (...a: unknown[]) => Buffer)(file, ...rest);
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  try {
    const { thread, entries } = await run(function* () {
      const { lib: library, bus } = yield* opened(lib);
      let entries: unknown = null;
      bus.subscribe((e) => { if (e.type === "library:list") entries = e.entries; });
      bus.send(ev({ type: "complete", data: {} }));   // nothing recorded: `complete` with no run is not a settle, and the list is not announced
      return { thread: library.read(id), entries };
    });
    assert.equal(entries, null);
    assert.ok(thread);
    assert.equal(thread.title, "Q?");
    assert.equal(thread.body, "The body.");
    assert.deepEqual({ mode: thread.mode, effort: thread.effort, direct: thread.direct }, { mode: "flat", effort: "ultra", direct: true }, "what the run chose is on the record");
    assert.deepEqual(thread.attachments, ["sha256:" + "a".repeat(64)]);
    assert.deepEqual(thread.exchanges, [{ question: "Follow-up?", body: "The follow-up body.", attachments: [] }]);
    assert.equal(thread.thread, "The body.\n\n---\n\n# Follow-up?\n\nThe follow-up body.", "what a restore commits to the trunk");
  } finally {
    fsModule.readFileSync = readFileSync;
    syncBuiltinESMExports();
  }
  assert.deepEqual([...opened_].sort(), ["exchange-1.json", "report.json"], "the records, and nothing else");
});

test("a folder without a record was never settled: it is not listed, a read finds nothing, and a release removes it", async () => {
  const lib = fresh();
  const unsettled = "2026-01-01T00-00-00-000";
  const other = "2026-01-02T00-00-00-000";
  fs.mkdirSync(path.join(lib, unsettled));
  fs.writeFileSync(path.join(lib, unsettled, "report.md"), "# Q?\n\n> 2026-01-01T00:00:00.000Z · flat · low · 1.0s\n\nWritten, then the crash.\n");   // the crash came before the record
  fs.mkdirSync(path.join(lib, other));
  writeBrief(path.join(lib, other), settled("Other?", "Settled."), { exchange: false, annexuresFrom: 0 });
  fs.writeFileSync(path.join(lib, other, "exchange-1.json"), '{"version":2,"query":"x"}');   // a record of another shape beside it
  const seen = await run(function* () {
    const wire = createChannel<WorkflowEvent, void>();
    const registry = yield* createAbilityRegistry({ configStore: createInMemoryConfigStore() });
    yield* Attachments.set(new NullAttachmentStore());
    const library = yield* openLibrary(() => lib, { events: createBus<WorkflowEvent>(), registry, wire, run: { busy: false } as never, abilities: [] });
    const said = yield* wire;
    yield* library.handlers.library_list!({ type: "library_list" });
    const listed = (yield* said.next()).value as Extract<WorkflowEvent, { type: "library:list" }>;
    const read = library.read(unsettled);
    library.release(unsettled);
    return { listed: listed.entries.map((e) => e.docId), read, thread: library.read(other) };
  });
  assert.deepEqual(seen.listed, [other], "only the settled brief is listed");
  assert.equal(seen.read, null);
  assert.equal(fs.existsSync(path.join(lib, unsettled)), false, "the folder went with the release");
  assert.ok(seen.thread);
  assert.deepEqual(seen.thread.exchanges, [], "an exchange of another shape is not read");
  assert.equal(asBriefRecord('{"version":2,"query":"x"}'), null);
  assert.equal(asBriefRecord(JSON.stringify({ ...settled("Q", "A"), effort: undefined })), null, "a missing field is not a record");
  assert.equal(asBriefRecord("not json"), null);
});

test("read ignores an exchange whose real path lies outside the brief's folder", async () => {
  const lib = fresh();
  const outside = fresh();
  const id = "2026-01-01T00-00-00-000";
  fs.mkdirSync(path.join(lib, id));
  writeBrief(path.join(lib, id), settled("Q?", "The body."), { exchange: false, annexuresFrom: 0 });
  writeBrief(path.join(lib, id), settled("Follow-up?", "The follow-up body."), { exchange: true, annexuresFrom: 0 });
  fs.writeFileSync(path.join(outside, "secret.json"), JSON.stringify(settled("leaked", "SECRET")));
  fs.symlinkSync(path.join(outside, "secret.json"), path.join(lib, id, "exchange-2.json"));
  const thread = await run(function* () { return (yield* opened(lib)).lib.read(id); });
  assert.ok(thread);
  assert.equal(thread.exchanges.length, 1);
  assert.equal(thread.exchanges[0].question, "Follow-up?");
  assert.doesNotMatch(thread.thread, /SECRET/);
});

test("two sessions' records on one brief reserve distinct annexure and exchange names", async () => {
  const lib = fresh();
  const id = "2026-01-01T00-00-00-000";
  fs.mkdirSync(path.join(lib, id));
  writeBrief(path.join(lib, id), settled("Q?", "The body."), { exchange: false, annexuresFrom: 0 });
  fs.writeFileSync(path.join(lib, id, "annexure-1.md"), "# Annexure 1\n\n---\n\nold\n");
  await run(function* () {
    const a = yield* opened(lib);
    const b = yield* opened(lib);
    a.lib.begin(id, ask(id), { warm: true });
    b.lib.begin(id, ask(id), { warm: true });   // the same brief, the same moment
    a.lib.written(id, wrote([{ task: "a's task", findings: "A's evidence" }], "A's answer"));
    b.lib.written(id, wrote([{ task: "b's task", findings: "B's evidence" }], "B's answer"));
    for (const s of [a, b]) s.bus.send(ev({ type: "complete", data: {} }));
  });
  const names = fs.readdirSync(path.join(lib, id)).sort();
  assert.deepEqual(names.filter((n) => /^annexure-/.test(n)), ["annexure-1.md", "annexure-2.md", "annexure-3.md"]);
  assert.deepEqual(names.filter((n) => /^exchange-/.test(n)), ["exchange-1.json", "exchange-1.md", "exchange-2.json", "exchange-2.md"]);
  const bodies = ["annexure-2.md", "annexure-3.md"].map((n) => fs.readFileSync(path.join(lib, id, n), "utf8"));
  assert.ok(bodies.some((t) => /A's evidence/.test(t)) && bodies.some((t) => /B's evidence/.test(t)));
  const exchanges = ["exchange-1.json", "exchange-2.json"].map((n) => asBriefRecord(fs.readFileSync(path.join(lib, id, n), "utf8"))?.answer);
  assert.deepEqual(exchanges.sort(), ["A's answer", "B's answer"]);
});

test("the record carries only what the writer measured, and the meta line says the same", async () => {
  const counted = await recorded([{ task: "t", findings: "f" }], { synthTokens: 41 });
  assert.equal(counted.record.synthTokens, 41);
  assert.equal("synthPpl" in counted.record, false);
  assert.match(counted.report, /41 synth tokens/);
  assert.doesNotMatch(counted.report, /ppl/);
  const measured = await recorded([{ task: "t", findings: "f" }], { synthTokens: 41, synthPpl: 1.234 });
  assert.equal(measured.record.synthPpl, 1.234);
  assert.match(measured.report, /41 synth tokens · ppl 1\.23/);
});

test("each inquiry's findings are filed as an annexure under its own task, in plan order, and indexed by the report", async () => {
  const r = await recorded([
    { task: "the near half", findings: "near findings" },
    { task: "the far half", findings: "far findings" },
  ]);
  assert.deepEqual(r.files, ["annexure-1.md", "annexure-2.md"]);
  assert.match(fs.readFileSync(path.join(r.dir, "annexure-1.md"), "utf8"), /\*\*Task:\*\* the near half[\s\S]*near findings/);
  assert.match(fs.readFileSync(path.join(r.dir, "annexure-2.md"), "utf8"), /\*\*Task:\*\* the far half[\s\S]*far findings/);
  assert.match(r.report, /- \[Annexure 1\]\(\.\/annexure-1\.md\) — the near half/);
  assert.match(r.report, /- \[Annexure 2\]\(\.\/annexure-2\.md\) — the far half/);
  assert.deepEqual(r.record.inquiries, [{ task: "the near half", findings: "near findings" }, { task: "the far half", findings: "far findings" }], "the record keeps every inquiry");
});

test("an inquiry that found nothing leaves no annexure, and the ones beside it keep their own numbers", async () => {
  const r = await recorded([
    { task: "the near half", findings: "" },
    { task: "the far half", findings: "far findings" },
  ]);
  assert.deepEqual(r.files, ["annexure-2.md"]);
  assert.match(r.report, /- \[Annexure 2\]\(\.\/annexure-2\.md\) — the far half/);
  assert.doesNotMatch(r.report, /Annexure 1/);
});

test("roots a tool result admitted ride the record beside the ask's own, once each", async () => {
  const lib = fresh();
  const own = "sha256:" + "a".repeat(64);
  const admitted = "sha256:" + "b".repeat(64);
  const root = (digest: string) => ({ mediaType: "application/vnd.oci.image.manifest.v1+json", digest, size: 700 });
  const id = await run(function* () {
    const { lib: library, bus } = yield* opened(lib);
    const docId = library.reserve();
    library.begin(docId, ask(docId, [root(own)]), { warm: false });
    bus.send(ev({ type: "agent:prefilled", agentId: 3, cells: 1629, role: "toolResult", attachments: [root(admitted), root(own)] }));
    library.written(docId, wrote([]));
    bus.send(ev({ type: "complete", data: {} }));   // the record lands as `complete` is said
    yield* library.settled(docId);
    return docId;
  });
  const record = asBriefRecord(fs.readFileSync(path.join(lib, id, "report.json"), "utf8"));
  assert.deepEqual(record?.attachments, [own, admitted]);
});
