/**
 * Capture every prompt that reaches the model across the research template's answer paths, as bytes on disk,
 * so a refactor of the prompt mechanism can be proven byte-identical with `cmp`. Two sources, both from the
 * scenario rig: `formatChatCalls` (every formatChat the mock context saw — spine headers, agent suffixes,
 * user deltas, the recovery turn) and the `prompt:format` trace entries (the compiled agent prompts).
 *
 * Run from the project root, with the app's INSTRUCTIONS empty (as shipped):
 *   node --import tsx test/prompt-bytes/capture.ts <outDir>
 *
 * Nondeterministic bytes (dates, temp paths, digests) are normalised so `cmp` compares the prompt's words.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileAttachmentStore } from "@lloyal-labs/media/node";
import { DOCUMENT_CONFIG_TYPE } from "@lloyal-labs/media";
import type { DocumentMeta, Attachment } from "@lloyal-labs/media";
import { WebSearchTool } from "../../node_modules/@lloyal-labs/web-ability/dist/tools/web-search.js";
import { runHarness, accept, answer } from "../invariants/harness.js";
import type { HarnessSpec, Utterance } from "../invariants/harness.js";

const outDir = process.argv[2];
if (!outDir) throw new Error("usage: capture.ts <outDir>");
fs.mkdirSync(outDir, { recursive: true });

const plan = (...tasks: string[]): string =>
  JSON.stringify({ intent: "research", tasks: tasks.map((description) => ({ description })), clarifyQuestions: [] });

const SOURCES = [{ title: "A source", url: "https://example.org/a" }];

function plantDocument(): { store: FileAttachmentStore; doc: Attachment } {
  const store = new FileAttachmentStore(fs.mkdtempSync(path.join(os.tmpdir(), "prompt-bytes-")));
  const title = "Fixture Paper";
  const meta: DocumentMeta = {
    title, pageCount: 1,
    sections: [{ heading: title, path: title, origin: "heuristic", startLine: 1, endLine: 2, pageStart: 1, pageEnd: 1 }],
    pages: [{ page: 1, startLine: 1, endLine: 4, chars: 30, imageObjects: 0, pathObjects: 0, taggedTables: 0, taggedFigures: 0 }],
    figures: [], tables: [],
    derive: { profile: "pdf.v1", pdfium: "test", dpi: 150, maxSide: 2048, maxPixels: 4194304, format: "image/png",
      renderedPages: 0, maxFigures: 16, maxTextPages: 400, tagged: false, structCoverage: 0, truncated: false },
  };
  const doc = store.putAttachment({
    representations: [store.putBlob(new TextEncoder().encode(`# ${title}\n\nAlpha beta gamma.\n`), "text/markdown")],
    config: { bytes: new TextEncoder().encode(JSON.stringify(meta)), mediaType: DOCUMENT_CONFIG_TYPE },
  });
  return { store, doc };
}

/** A reaped inquiry: the web is stubbed at the tool boundary (one result per search, never the network), so the
 *  agent searches every turn until the pool reaps it; the recovery turn is the report. */
function reaped(): HarnessSpec {
  WebSearchTool.prototype.execute = function* (args: { query: string }) {
    return { results: [{ title: `About ${args.query}`, url: `https://a.io/${args.query}`, snippet: `${args.query}, in brief` }] };
  } as typeof WebSearchTool.prototype.execute;
  let recovering = false;
  let n = 0;
  const search = (): Utterance => ({
    text: "", kind: "tool", tool: { name: "web_search", args: { query: `q${++n}` } }, stallTokens: 12,
    then: () => (recovering ? { text: "what was found", kind: "report", sources: SOURCES } : search()),
  });
  return {
    utterances: [{ text: plan("only"), kind: "text" }, search()],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } as any },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => { if (ev.type === "agent:done") recovering = true; return ev.type === "agent:done"; } },
      { on: (ev) => ev.type === "complete" },
    ],
  };
}

const paths: Record<string, () => HarnessSpec> = {
  "flat-two": () => ({
    utterances: [{ text: plan("one", "two"), kind: "text" }, { text: "f1", kind: "report", sources: SOURCES }, { text: "f2", kind: "report" }, { text: "settled", kind: "text" }],
    script: [{ send: { type: "submit_query", query: "Q?", mode: "flat" } as any }, { on: (e) => e.type === "ui:plan_review", send: accept }, { on: (e) => e.type === "complete" }],
  }),
  "deep-two": () => ({
    utterances: [{ text: plan("one", "two"), kind: "text" }, { text: "f1", kind: "report", sources: SOURCES }, { text: "f2", kind: "report" }, { text: "settled", kind: "text" }],
    script: [{ send: { type: "submit_query", query: "Q?", mode: "deep" } as any }, { on: (e) => e.type === "ui:plan_review", send: accept }, { on: (e) => e.type === "complete" }],
  }),
  "lone": () => ({
    utterances: [{ text: plan("only"), kind: "text" }, { text: "found", kind: "report" }],
    script: [{ send: { type: "submit_query", query: "Q?", mode: "flat" } as any }, { on: (e) => e.type === "ui:plan_review", send: accept }, { on: (e) => e.type === "complete" }],
  }),
  "direct-and-follow-up": () => ({
    utterances: [{ text: "A.", kind: "text" }, { text: "B.", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat", skipPlanner: true } as any },
      { on: (e) => e.type === "complete", send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } as any },
      { on: (e) => e.type === "complete" },
    ],
  }),
  "clarify-then-passthrough": () => ({
    utterances: [
      { text: JSON.stringify({ intent: "clarify", tasks: [], clarifyQuestions: ["Which one?"] }), kind: "text" },
      { text: JSON.stringify({ intent: "passthrough", tasks: [], clarifyQuestions: [] }), kind: "text" },
      { text: "From the trunk.", kind: "text" },
    ],
    script: [{ send: { type: "submit_query", query: "Q?", mode: "flat" } as any }, { on: (e) => e.type === "ui:clarify", send: answer("This one.") }, { on: (e) => e.type === "complete" }],
  }),
  "reaped-recovery": reaped,
  "two-sources-coverage": () => {
    const { store, doc } = plantDocument();
    return {
      attachmentStore: store,
      utterances: [
        { text: "this source covers the question", kind: "text" },
        { text: "this source covers it too", kind: "text" },
        { text: plan("one", "two"), kind: "text" },
        { text: "first finding", kind: "report" },
        { text: "second finding", kind: "report" },
        { text: "the settled brief", kind: "text" },
      ],
      script: [
        { send: { type: "submit_query", query: "Q?", mode: "flat", attachments: [doc] } as any },
        { on: (ev) => ev.type === "ui:plan_review", send: accept },
        { on: (ev) => ev.type === "complete" },
      ],
    };
  },
};

/** Bytes that vary per run and are not the prompt's words. */
const normalise = (s: string): string =>
  s.replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, "<DATE>")
    .replace(/\/(?:private\/)?(?:var|tmp)\/[^\s"'`)]+/g, "<TMP>")
    .replace(/sha256:[0-9a-f]+/g, "sha256:<DIGEST>")
    .replace(/[0-9a-f]{32,}/g, "<HEX>");

let total = 0;
for (const [name, spec] of Object.entries(paths)) {
  let reached: string[] = [];
  const run = await runHarness({ ...spec(), instrument: (c) => { reached = c.formatChatCalls; } });
  const formatted = reached.map((m) => { try { return JSON.stringify(JSON.parse(m), null, 2); } catch { return m; } });
  const traced = (run.trace as unknown as { type: string; role?: string; agentId?: number; promptText?: string }[])
    .filter((t) => t.type === "prompt:format")
    .map((t) => `role=${t.role ?? ""} agent=${t.agentId ?? ""}\n${t.promptText ?? ""}`);
  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });
  formatted.forEach((t, i) => fs.writeFileSync(path.join(dir, `format-${String(i).padStart(2, "0")}.txt`), normalise(t)));
  traced.forEach((t, i) => fs.writeFileSync(path.join(dir, `trace-${String(i).padStart(2, "0")}.txt`), normalise(t)));
  total += formatted.length + traced.length;
  console.log(`${name}: ${formatted.length} formatChat, ${traced.length} prompt:format, ${run.events.length} events`);
}
console.log(`${total} files under ${outDir}`);
