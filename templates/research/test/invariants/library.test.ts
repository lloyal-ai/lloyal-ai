/**
 * The library on its own: its reads are confined (a planted symlink named like
 * an exchange must not pull a file from outside the folder onto the wire), and
 * the run record is shared by every session on a brief, so a file name is a
 * reservation — two records on one brief never write over each other's
 * evidence — and the roots a tool admitted ride the meta line once each.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run, createChannel } from "effection";
import type { Operation } from "effection";
import { createBus } from "@lloyal-labs/binding";
import type { EventBus } from "@lloyal-labs/binding";
import { Attachments } from "@lloyal-labs/lloyal-agents";
import { NullAttachmentStore } from "@lloyal-labs/media";
import { createAbilityRegistry, createInMemoryConfigStore } from "@lloyal-labs/rig";
import { openLibrary, provenanceOf } from "../../src/brief/library.js";
import type { Library } from "../../src/brief/library.js";
import type { WorkflowEvent } from "../../src/brief/protocol.js";
import type { Inputs } from "../../src/research/research.js";

const REPORT = "# Q?\n\n> 2026-01-01T00:00:00.000Z · flat · 1.0s\n\nThe body.\n";
const EXCHANGE = "# Follow-up?\n\n> 2026-01-01T00:01:00.000Z · flat · 1.0s\n\nThe follow-up body.\n";
const ev = (e: Record<string, unknown>): WorkflowEvent => e as unknown as WorkflowEvent;
const ask = (docId: string, attachments: { digest: string }[] = []): Inputs =>
  ({ docId, text: "Q?", mode: "flat", direct: false, effort: "low", attachments, excluded: [], sources: [] }) as unknown as Inputs;

/** One session's library over `dir`, with the bus it reads. */
function* opened(dir: string): Operation<{ lib: Library; bus: EventBus<WorkflowEvent> }> {
  const registry = yield* createAbilityRegistry({ configStore: createInMemoryConfigStore() });
  const bus = createBus<WorkflowEvent>();
  bus.subscribe(() => {});
  yield* Attachments.set(new NullAttachmentStore());
  const lib = yield* openLibrary(() => dir, { events: bus, registry, wire: createChannel<WorkflowEvent, void>(), run: { busy: false } as never, abilities: [] });
  return { lib, bus };
}

test("read ignores an exchange whose real path lies outside the brief's folder", async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
  const id = "2026-01-01T00-00-00-000";
  fs.mkdirSync(path.join(lib, id));
  fs.writeFileSync(path.join(lib, id, "report.md"), REPORT);
  fs.writeFileSync(path.join(lib, id, "exchange-1.md"), EXCHANGE);
  fs.writeFileSync(path.join(outside, "secret.md"), "# leaked\n\n> x\n\nSECRET\n");
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(lib, id, "exchange-2.md"));
  const thread = await run(function* () { return (yield* opened(lib)).lib.read(id); });
  assert.ok(thread);
  assert.equal(thread.exchanges.length, 1);
  assert.equal(thread.exchanges[0].question, "Follow-up?");
  assert.doesNotMatch(thread.thread, /SECRET/);
});

test("two sessions' records on one brief reserve distinct annexure names", async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));
  const id = "2026-01-01T00-00-00-000";
  fs.mkdirSync(path.join(lib, id));
  fs.writeFileSync(path.join(lib, id, "report.md"), REPORT);
  fs.writeFileSync(path.join(lib, id, "annexure-1.md"), "# Annexure 1\n\n---\n\nold\n");
  await run(function* () {
    const a = yield* opened(lib);
    const b = yield* opened(lib);
    a.lib.begin(id, ask(id), { warm: true });
    b.lib.begin(id, ask(id), { warm: true });   // the same brief, the same moment
    for (const s of [a, b]) s.bus.send(ev({ type: "research:start" }));
    a.bus.send(ev({ type: "agent:spawn", agentId: 11 }));
    b.bus.send(ev({ type: "agent:spawn", agentId: 22 }));
    a.bus.send(ev({ type: "agent:return", agentId: 11, result: "A's evidence" }));
    b.bus.send(ev({ type: "agent:return", agentId: 22, result: "B's evidence" }));
  });
  const written = fs.readdirSync(path.join(lib, id)).filter((n) => /^annexure-\d+\.md$/.test(n)).sort();
  assert.deepEqual(written, ["annexure-1.md", "annexure-2.md", "annexure-3.md"]);
  const bodies = written.map((n) => fs.readFileSync(path.join(lib, id, n), "utf8"));
  assert.ok(bodies.some((t) => /A's evidence/.test(t)) && bodies.some((t) => /B's evidence/.test(t)));
});

/** One run's evidence, written into a fresh library: the wire a flat fan-out carries, `send` by `send`. */
async function recorded(tasks: string[], wire: (bus: EventBus<WorkflowEvent>) => void): Promise<{ dir: string; files: string[]; report: string }> {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));
  const id = await run(function* () {
    const { lib: library, bus } = yield* opened(lib);
    const docId = library.reserve();
    library.begin(docId, ask(docId), { warm: false });
    bus.send(ev({ type: "research:start", agentCount: tasks.length, mode: "flat" }));
    bus.send(ev({ type: "fanout:tasks", tasks: tasks.map((description) => ({ description })) }));
    wire(bus);
    bus.send(ev({ type: "answer", text: "the answer" }));
    bus.send(ev({ type: "complete", data: {} }));   // the report lands as `complete` is said
    yield* library.settled(docId);
    return docId;
  });
  const dir = path.join(lib, id);
  return {
    dir,
    files: fs.readdirSync(dir).filter((n) => /^annexure-\d+\.md$/.test(n)).sort(),
    report: fs.readFileSync(path.join(dir, "report.md"), "utf8"),
  };
}

/** The annexure whose body carries `findings`, whole. */
const annexureWith = (r: { dir: string; files: string[] }, findings: string): string => {
  const hit = r.files.map((n) => fs.readFileSync(path.join(r.dir, n), "utf8")).filter((t) => t.includes(findings));
  assert.equal(hit.length, 1, `exactly one annexure holds "${findings}" (of ${r.files.join(", ")})`);
  return hit[0];
};

test("an inquiry's findings are filed under the task its key names, whatever order the agents were admitted in", async () => {
  // The pool seats what the context can hold: a wide plan's later task can be admitted FIRST. The key
  // (`task:<i>`) is the logical identity; arrival order is not.
  const r = await recorded(["the near half", "the far half"], (bus) => {
    bus.send(ev({ type: "agent:spawn", agentId: 21, key: "task:1" }));
    bus.send(ev({ type: "agent:spawn", agentId: 20, key: "task:0" }));
    bus.send(ev({ type: "agent:return", agentId: 21, result: "far findings" }));
    bus.send(ev({ type: "agent:return", agentId: 20, result: "near findings" }));
  });
  assert.deepEqual(r.files, ["annexure-1.md", "annexure-2.md"]);
  assert.match(annexureWith(r, "near findings"), /\*\*Task:\*\* the near half/);
  assert.match(annexureWith(r, "far findings"), /\*\*Task:\*\* the far half/);
  // And the index the report ends with names each annexure by its own task.
  assert.match(r.report, /- \[Annexure 1\]\(\.\/annexure-1\.md\) — the near half/);
  assert.match(r.report, /- \[Annexure 2\]\(\.\/annexure-2\.md\) — the far half/);
});

test("a healed inquiry files its findings as its task's annexure — no second file, no hole in the numbering", async () => {
  // A heal is a NEW agent under the SAME key: the evidence it brings back is that task's, not a third task's.
  const r = await recorded(["the only task"], (bus) => {
    bus.send(ev({ type: "agent:spawn", agentId: 30, key: "task:0" }));
    bus.send(ev({ type: "agent:failed", agentId: 30, reason: "decode_error" }));
    bus.send(ev({ type: "agent:spawn", agentId: 31, key: "task:0" }));   // the replacement
    bus.send(ev({ type: "agent:return", agentId: 31, result: "the healed findings" }));
  });
  assert.deepEqual(r.files, ["annexure-1.md"]);
  assert.match(annexureWith(r, "the healed findings"), /\*\*Task:\*\* the only task/);
  assert.match(r.report, /- \[Annexure 1\]\(\.\/annexure-1\.md\) — the only task/);
});

test("roots a tool result admitted ride the meta line beside the ask's own, once each", async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));
  const own = "sha256:" + "a".repeat(64);
  const admitted = "sha256:" + "b".repeat(64);
  const root = (digest: string) => ({ mediaType: "application/vnd.oci.image.manifest.v1+json", digest, size: 700 });
  const id = await run(function* () {
    const { lib: library, bus } = yield* opened(lib);
    const docId = library.reserve();
    library.begin(docId, ask(docId, [root(own)]), { warm: false });
    bus.send(ev({ type: "agent:prefilled", agentId: 3, cells: 1629, role: "toolResult", attachments: [root(admitted), root(own)] }));
    bus.send(ev({ type: "answer", text: "the answer" }));
    bus.send(ev({ type: "complete", data: {} }));   // the report lands as `complete` is said
    yield* library.settled(docId);
    return docId;
  });
  const meta = fs.readFileSync(path.join(lib, id, "report.md"), "utf8").split("\n")[2] ?? "";
  assert.ok(meta.includes(`media ${own} ${admitted}`), meta);
  assert.equal(meta.split(own).length - 1, 1);
});

test("a settled brief records the dial that wrote it, and one written before it still reads", () => {
  // The byline used to read the READER's current effort, so the same brief said "Quick" in one session
  // and "Standard" in the next, and an Ask read back as a Survey. The record has to carry its own
  // provenance — and it has to keep reading the reports that already exist, which carry none.
  const written = provenanceOf("> 2026-09-16T00:00:00.000Z · flat · low · ask · 41 synth tokens · ppl 1.2 · 3.0s");
  assert.deepEqual(written, { mode: "flat", effort: "low", direct: true }, "what the run chose is on the line");

  const survey = provenanceOf("> 2026-09-16T00:00:00.000Z · deep · ultra · 41 synth tokens · ppl 1.2 · 3.0s");
  assert.deepEqual(survey, { mode: "deep", effort: "ultra", direct: false }, "no `ask` means it went through the planner");

  // The 40-odd briefs already on disk: mode only, then straight into the stats.
  const old = provenanceOf("> 2026-09-15T00:00:00.000Z · flat · 2541 synth tokens · ppl 1.35 · 451.2s · media sha256:abc");
  assert.deepEqual(old, { mode: "flat", effort: null, direct: false }, "an older report reads back, minus what it never said");

  assert.deepEqual(provenanceOf("not a meta line"), { mode: null, effort: null, direct: false }, "and a malformed line is not a throw");
});
