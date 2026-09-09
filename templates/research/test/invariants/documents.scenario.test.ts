/**
 * A document attached to a question is an ASSET AVAILABLE TO THE RUN: staged
 * into the pool (zero KV), listed on the spine, recorded on the report's meta
 * line, restored by `open_doc`, staged again by a warm ask — and never
 * projected. Sight is asked of the model only by what materializes to pixels.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileAttachmentStore } from "@lloyal-labs/media/node";
import { DOCUMENT_CONFIG_TYPE } from "@lloyal-labs/media";
import type { Attachment, DocumentMeta } from "@lloyal-labs/media";
import type { MockSessionContext } from "@lloyal-labs/sdk/testing";
import { runHarness } from "./harness.js";
import type { WorkflowEvent } from "../../harness/protocol.js";
import type { TraceEvent } from "@lloyal-labs/lloyal-agents";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const TITLE = "Fixture Paper";

/** A store holding one document (title, two sections, one page) and one image. */
function plant(): { store: FileAttachmentStore; doc: Attachment; image: Attachment } {
  const store = new FileAttachmentStore(fs.mkdtempSync(path.join(os.tmpdir(), "documents-scn-")));
  const image = store.putAttachment({ representations: [store.putBlob(PNG, "image/png")] });
  const markdown = `# ${TITLE}\n\n## Findings\n\nAlpha beta gamma.\n`;
  const meta: DocumentMeta = {
    title: TITLE, pageCount: 1,
    sections: [
      { heading: TITLE, path: TITLE, origin: "heuristic", startLine: 1, endLine: 2, pageStart: 1, pageEnd: 1 },
      { heading: "Findings", path: "Findings", origin: "heuristic", startLine: 3, endLine: 6, pageStart: 1, pageEnd: 1 },
    ],
    pages: [{ page: 1, startLine: 1, endLine: 6, chars: 30, imageObjects: 0, pathObjects: 0, taggedTables: 0, taggedFigures: 0 }],
    figures: [], tables: [],
    derive: { profile: "pdf.v1", pdfium: "test", dpi: 150, maxSide: 2048, maxPixels: 4194304, format: "image/png",
      renderedPages: 0, maxFigures: 16, maxTextPages: 400, tagged: false, structCoverage: 0, truncated: false },
  };
  const doc = store.putAttachment({
    representations: [store.putBlob(new TextEncoder().encode(markdown), "text/markdown")],
    config: { bytes: new TextEncoder().encode(JSON.stringify(meta)), mediaType: DOCUMENT_CONFIG_TYPE },
  });
  return { store, doc, image };
}

const report = { text: "Findings: alpha beta gamma.", kind: "report" as const };
const ask = (query: string, attachments?: Attachment[]) =>
  ({ type: "submit_query", query, mode: "flat", skipPlanner: true, ...(attachments ? { attachments } : {}) }) as const;

/** The spine prompts a run formatted — where an ability's reference block lives. */
const spinePrompts = (trace: readonly TraceEvent[]): string[] =>
  trace
    .filter((e): e is Extract<TraceEvent, { type: "prompt:format" }> => e.type === "prompt:format" && (e as { role?: string }).role === "spine")
    .map((e) => e.promptText);

/** Every prefill that carried roots, by role — projection leaves this trail. */
const rootPrefills = (trace: readonly TraceEvent[]): { role: string; attachments: readonly Attachment[] }[] =>
  trace
    .filter((e): e is Extract<TraceEvent, { type: "branch:prefill" }> => e.type === "branch:prefill")
    .filter((e) => (e.attachments?.length ?? 0) > 0)
    .map((e) => ({ role: e.role, attachments: e.attachments! }));

const metaLine = (outputDir: string, docId: string): string =>
  fs.readFileSync(path.join(outputDir, docId, "report.md"), "utf8").split("\n")[2] ?? "";

test("a document on the question: listed on the spine, recorded on the meta line, never projected", async () => {
  const { store, doc } = plant();
  let ctx!: MockSessionContext;
  const run = await runHarness({
    attachmentStore: store,
    instrument: (c) => { ctx = c; },
    utterances: [report],
    script: [
      { send: ask("What does the paper find?", [doc]) },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  assert.equal(run.events.filter((e) => e.type === "ui:error").length, 0, "no error toast");
  const query = run.events.find((e) => e.type === "query") as { docId: string; attachments?: Attachment[] };
  assert.deepEqual(query.attachments?.map((a) => a.digest), [doc.digest], "the echo carries the root");

  const spines = spinePrompts(run.trace);
  assert.ok(spines.length > 0, "a spine was formatted");
  assert.ok(spines.some((p) => p.includes("# document_research — available files") && p.includes(TITLE)),
    "the documents reference block names the paper");

  // Availability is not projection: nothing was embedded, on any branch.
  assert.equal(ctx.multimodalPrefills.length, 0);
  assert.deepEqual(rootPrefills(run.trace), []);

  assert.ok(metaLine(run.outputDir, query.docId).includes(doc.digest), "the meta line carries the root");
});

test("reopen restores the document; a warm ask stages it again; a cold submit does not", async () => {
  const { store, doc } = plant();
  const saved = "2026-01-01T00-00-00-000";
  const run = await runHarness({
    attachmentStore: store,
    setup: (dir) => {
      fs.mkdirSync(path.join(dir, saved), { recursive: true });
      fs.writeFileSync(
        path.join(dir, saved, "report.md"),
        [`# Saved brief`, "", `> ${saved} · flat · 1s · media ${doc.digest}`, "The saved body."].join("\n"),
      );
    },
    utterances: [report, report],
    script: [
      { send: { type: "open_doc", docId: saved } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === saved,
        send: ask("And the findings?") },
      { on: (ev) => ev.type === "complete", send: { type: "open_doc", docId: null } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === null,
        send: ask("Something unrelated.") },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  assert.equal(run.events.filter((e) => e.type === "ui:error").length, 0);
  const restored = run.events.find((e) => e.type === "doc") as { attachments?: Attachment[] };
  assert.deepEqual(restored.attachments?.map((a) => a.digest), [doc.digest], "open_doc restored the root");

  const spines = spinePrompts(run.trace);
  assert.equal(spines.length, 2, "one spine per ask");
  assert.ok(spines[0].includes(TITLE), "the warm ask on the reopened thread lists the paper");
  assert.ok(!spines[1].includes(TITLE), "a cold submit elsewhere does not");
  assert.deepEqual(rootPrefills(run.trace), []);
});

test("a model with no projector still takes a document — sight is asked only of pixels", async () => {
  const { store, doc } = plant();
  const run = await runHarness({
    attachmentStore: store,
    instrument: (c) => { c.mockSupportsVision = false; },
    utterances: [report],
    script: [
      { send: ask("What does the paper find?", [doc]) },
      { on: (ev) => ev.type === "complete" || ev.type === "ui:error" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "ui:error").length, 0, "no vision toast for a document");
  assert.ok(run.events.some((e) => e.type === "complete"));
});

test("an image beside a document is projected exactly once, on the trunk — a warm ask adds nothing", async () => {
  const { store, doc, image } = plant();
  let ctx!: MockSessionContext;
  const run = await runHarness({
    attachmentStore: store,
    instrument: (c) => { ctx = c; },
    utterances: [report, report],
    script: [
      { send: ask("What do the picture and the paper say?", [image, doc]) },
      { on: (ev) => ev.type === "complete", send: ask("And in more detail?") },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  assert.equal(run.events.filter((e) => e.type === "ui:error").length, 0);
  assert.equal(ctx.multimodalPrefills.length, 1, "one projection across both runs");
  const carried = rootPrefills(run.trace);
  assert.equal(carried.length, 1);
  assert.equal(carried[0].role, "warmDelta", "the trunk, not a spine header");
  assert.deepEqual(carried[0].attachments.map((a) => a.digest), [image.digest]);

  const spines = spinePrompts(run.trace);
  assert.equal(spines.length, 2);
  assert.ok(spines.every((p) => p.includes(TITLE)), "both asks list the paper");
  const query = run.events.find((e) => e.type === "query") as { docId: string };
  const meta = metaLine(run.outputDir, query.docId);
  assert.ok(meta.includes(image.digest) && meta.includes(doc.digest));
});
