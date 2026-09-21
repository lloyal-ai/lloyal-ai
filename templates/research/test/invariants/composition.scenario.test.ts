/**
 * The plug point is where `app.ts` says it is: the algorithm is handed to the brief. Each scenario composes the
 * harness the way `app.ts` does with one part exchanged — a settling stage, a planner, the whole writer — and
 * runs it for real.
 *
 * The contract is the same for every part: a replacement RETURNS a value and may say nothing on the wire. The
 * brief publishes the plan, says when writing began and ended, and keeps what came back, so the reader sees a
 * coherent brief whatever they were handed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { sleep } from "effection";
import type { Operation } from "effection";
import type { Branch } from "@lloyal-labs/sdk";
import { Tool, parallel } from "@lloyal-labs/lloyal-agents";
import type { Agent, JsonSchema, ToolLifecycleHooks } from "@lloyal-labs/lloyal-agents";
import type { Output } from "@lloyal-labs/rig";
import { initializeHarness, useExecution, serveCommands, serveDefaults } from "@lloyal-labs/rig";
import type { PlanResult } from "@lloyal-labs/rig";
import { settings } from "@lloyal-labs/rig/node";
import { abilities, config, harness } from "../../src/app.js";
import { briefs } from "../../src/harness/brief.js";
import { openLibrary } from "../../src/harness/library.js";
import type { Command, WorkflowEvent } from "../../src/protocol.js";
import * as research from "../../src/harness/research.js";

import type { Evidence, Inputs, Research, Written } from "../../src/harness/research.js";
import { reduce, initialState } from "../../src/ui/state.js";
import type { AppState } from "../../src/ui/state.js";
import { selectClarify, selectOutline, selectSections } from "../../src/ui/select.js";
import { FRAMING } from "../../src/ui/devtools.js";
import { createPaneModel, foldEvent } from "@lloyal-labs/dev-tools";
import type { DevEvent } from "@lloyal-labs/dev-tools";
import { WebSearchTool } from "../../node_modules/@lloyal-labs/web-ability/dist/tools/web-search.js";
import { runHarness, docIdOfQuery, accept } from "./harness.js";
import type { Utterance } from "./harness.js";
import * as os from "node:os";
import { FileAttachmentStore } from "@lloyal-labs/media/node";
import { DOCUMENT_CONFIG_TYPE } from "@lloyal-labs/media";
import type { Attachment, DocumentMeta } from "@lloyal-labs/media";

const TWO_TASKS = JSON.stringify({ intent: "research", tasks: [{ description: "one" }, { description: "two" }], clarifyQuestions: [] });

/** `app.ts`'s composition with the algorithm exchanged — the one line a developer changes. */
const composed = (algorithm: Research): typeof harness => function* (ctx, events, commands) {
  const { session, wire, runner, registry, store } = yield* initializeHarness(ctx, events, { abilities, config });
  const run = yield* useExecution();
  const library = yield* openLibrary(() => runner.config().sources.outputDir, { events, registry, wire, run, abilities });
  const brief = briefs({ session, library, run, wire, config: runner.config, research: algorithm });
  yield* wire.send({ type: "weights:done" });
  yield* serveCommands<Command>(commands, [brief, library, settings({ runner, registry, store, wire, run, abilities, config })], serveDefaults({ wire, run, abandon: brief.abortRun }));
};

/** What the canvas holds the moment `at` is announced: the real fold over the wire this run carried. */
const foldTo = (events: readonly WorkflowEvent[], at: WorkflowEvent["type"]): AppState => {
  const end = events.findIndex((e) => e.type === at);
  assert.ok(end >= 0, `the wire never carried ${at}`);
  return events.slice(0, end + 1).reduce(reduce, initialState);
};

test("the stock writer with only its settling stage replaced runs to a settled brief", async () => {
  const settle = function* (_spine: Branch, _ask: Inputs, _plan: PlanResult, { findings }: Evidence): Operation<{ answer: string; tokens: number; timeMs: number }> {
    return { answer: `SETTLED BY HAND: ${findings.map((f) => f.trim()).join(" + ")}`, tokens: 0, timeMs: 0 };
  };
  const run = await runHarness({
    harness: composed({ ...research, write: (trunk, ask, plan) => research.write(trunk, ask, plan, { settle }) }),
    utterances: [
      { text: TWO_TASKS, kind: "text" },
      { text: "first finding", kind: "report" },
      { text: "second finding", kind: "report" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "synthesize:start").length, 0, "the stock settling pass never ran");
  assert.equal(run.events.filter((e) => e.type === "research:start").length, 1, "the stock inquiries did");
  const report = fs.readFileSync(path.join(run.outputDir, docIdOfQuery(run.events), "report.md"), "utf8");
  assert.match(report, /SETTLED BY HAND: (first finding \+ second finding|second finding \+ first finding)/);
});

test("a replaced planner keeps the stock review, continuation and library behaviour", async () => {
  let calls = 0;
  const plan = function* (_trunk: Branch | null, ask: Inputs): Operation<PlanResult> {
    calls++;
    return { intent: "research", tasks: [{ description: `look into: ${ask.text}` }], clarifyQuestions: [], tokenCount: 0, timeMs: 0 } as PlanResult;
  };
  const run = await runHarness({
    harness: composed({ ...research, plan }),
    utterances: [{ text: "the finding", kind: "report" }, { text: "The follow-up.", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete", send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  // Direct invocation evidence: the replacement counted its own calls. Zero `preflight:start` would
  // NOT prove this — preflight needs two participating sources and this fixture has one, so stock
  // planning would emit none either.
  assert.equal(calls, 1, "the replacement planner was not the one that ran");
  assert.equal(run.events.filter((e) => e.type === "plan:start").length, 2, "each round is opened by the brief: the planned ask and the direct one");
  assert.equal(run.events.filter((e) => e.type === "ui:plan_review").length, 1, "the review is the brief's, kept");
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  assert.match(fs.readFileSync(path.join(dir, "annexure-1.md"), "utf8"), /\*\*Task:\*\* look into: Q\?/, "the inquiry worked the replacement's task");
  assert.ok(fs.existsSync(path.join(dir, "report.md")), "the library kept the brief");
  assert.equal(fs.readdirSync(dir).filter((f) => /^exchange-\d+\.md$/.test(f)).length, 1, "and the continuation threaded beside it");
});

test("a replacement planner's RETURNED plan is the outline the reader reviews and the sections the brief is written into", async () => {
  const plan = function* (_trunk: Branch | null, ask: Inputs): Operation<PlanResult> {
    return {
      intent: "research",
      tasks: [{ description: `the near half of: ${ask.text}` }, { description: "the far half" }],
      clarifyQuestions: [], tokenCount: 0, timeMs: 0,
    } as PlanResult;
  };
  const settle = function* (_spine: Branch, _ask: Inputs, _plan: PlanResult, { findings }: Evidence): Operation<{ answer: string; tokens: number; timeMs: number }> {
    return { answer: `the brief, from ${findings.length} inquiries`, tokens: 0, timeMs: 0 };
  };
  const run = await runHarness({
    harness: composed({ ...research, plan, write: (trunk, ask, p) => research.write(trunk, ask, p, { settle }) }),
    utterances: [
      { text: "near findings", kind: "report" },
      { text: "far findings", kind: "report" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  // The reader's yes is a yes to THIS plan: the review shows what the planner returned.
  assert.deepEqual(selectOutline(foldTo(run.events, "ui:plan_review")), ["the near half of: Q?", "the far half"]);
  // And the Write moment is written into its tasks — the sections ARE the plan.
  const sections = selectSections(foldTo(run.events, "research:done"));
  assert.deepEqual(sections.map((s) => s.title), ["the near half of: Q?", "the far half"]);
  assert.deepEqual([...sections.map((s) => s.prose)].sort(), ["far findings", "near findings"]);
});

test("a replacement planner's questions are the ones the composer asks the reader to answer", async () => {
  const plan = function* (): Operation<PlanResult> {
    return { intent: "clarify", tasks: [], clarifyQuestions: ["Which timeframe?", "Which region?"], tokenCount: 0, timeMs: 0 } as PlanResult;
  };
  const run = await runHarness({
    harness: composed({ ...research, plan }),
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:clarify" },
    ],
  });
  assert.deepEqual(selectClarify(foldTo(run.events, "ui:clarify")), ["Which timeframe?", "Which region?"]);
});

test("replanning from an open review withdraws it: the brief owns the reset, not the algorithm", async () => {
  // A replacement planner RETURNS a PlanResult and emits nothing. The fold's planning reset — leave
  // plan_review, drop the parked plan, set the mode, empty the roster — used to ride `plan:start`,
  // which only the stock planner sent. So a replan from an open review left the reader looking at the
  // PREVIOUS round's outline, still acceptable, for as long as the new planner took.
  let round = 0;
  const plan = function* (_t: Branch | null, ask: Inputs): Operation<PlanResult> {
    round++;
    return { intent: "research", tasks: [{ description: `round ${round}: ${ask.text}` }], clarifyQuestions: [], tokenCount: 0, timeMs: 0 } as PlanResult;
  };
  const run = await runHarness({
    harness: composed({ ...research, plan }),
    utterances: [{ text: "the finding", kind: "report" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "deep" } },
      { on: (ev) => ev.type === "ui:plan_review", send: { type: "change_mode", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review" },
    ],
  });

  // Fold the run and watch the phase between the two reviews.
  let s: AppState = initialState;
  const phases: string[] = [];
  let reviews = 0;
  const between: string[] = [];
  for (const ev of run.events) {
    s = reduce(s, ev);
    if (ev.type === "ui:plan_review") reviews++;
    const doc = s.activeDocId ? s.documents.get(s.activeDocId) : undefined;
    if (doc) { phases.push(doc.phase); if (reviews === 1 && ev.type !== "ui:plan_review") between.push(doc.phase); }
  }
  const doc = s.documents.get(s.activeDocId!)!;
  assert.equal(reviews, 2, "both rounds parked a review");
  assert.ok(between.includes("planning"),
    `the canvas never left the first review while the replacement planner ran: ${JSON.stringify([...new Set(between)])}`);
  assert.equal(doc.mode, "flat", "the reader's mode never reached the fold");
  assert.deepEqual(selectOutline(s), ["round 2: Q?"], "the second round's plan is the one on the canvas");
});

/** A planner and a writer that touch no model and say nothing on the wire: the smallest algorithm the brief can be handed. */
const onePlan = function* (_trunk: Branch | null, ask: Inputs): Operation<PlanResult> {
  return { intent: "research", tasks: [{ description: `look into: ${ask.text}` }], clarifyQuestions: [], tokenCount: 0, timeMs: 0 } as PlanResult;
};
const silent = (body: (ask: Inputs) => Operation<void> = function* () {}): Research["write"] =>
  function* (_trunk, ask, plan): Operation<Written> {
    yield* body(ask);
    return { answer: `WRITTEN BY HAND: ${ask.text}`, inquiries: [], stats: { ctxPct: 0, ctxPos: 0, ctxTotal: 1 }, complete: { intent: plan.intent } };
  };

test("a whole writer that says nothing on the wire still gives a brief its life: writing, saved, and warm for a follow-up", async () => {
  const run = await runHarness({
    harness: composed({ plan: onePlan, write: silent() }),
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete", send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  // The reader is shown a brief being written, not a plan still being framed, for as long as the writer works.
  let s: AppState = initialState;
  const beforeTheAnswer: string[] = [];
  for (const ev of run.events) {
    if (ev.type === "answer") break;
    s = reduce(s, ev);
    const doc = s.runDocId ? s.documents.get(s.runDocId) : undefined;
    if (doc) beforeTheAnswer.push(doc.phase);
  }
  assert.equal(beforeTheAnswer[beforeTheAnswer.length - 1], "research", `the canvas never reached the writing moment: ${JSON.stringify([...new Set(beforeTheAnswer)])}`);
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  assert.match(fs.readFileSync(path.join(dir, "report.md"), "utf8"), /WRITTEN BY HAND: Q\?/, "the library kept what the writer returned");
  assert.match(fs.readFileSync(path.join(dir, "exchange-1.md"), "utf8"), /WRITTEN BY HAND: And then\?/, "and the follow-up threaded beside it");
});

test("a whole writer that says nothing on the wire can still be stopped", async () => {
  const run = await runHarness({
    harness: composed({ plan: onePlan, write: silent(function* () { yield* sleep(60_000); }) }),
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "research:start", send: { type: "stop" } },
      { on: (ev) => ev.type === "run:aborted" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "answer").length, 0, "nothing was written");
  assert.deepEqual(fs.readdirSync(run.outputDir), [], "and the brief's folder went with the stop");
});

/** What the settling agent was given to read: its own compiled prompt, and whether the spine it forks from grew. */
const settlingSaw = (run: { trace: readonly unknown[] }): { prompt: string; spineGrew: number } => {
  const trace = run.trace as { type: string; role?: string; promptText?: string }[];
  const prompts = trace.filter((t) => t.type === "prompt:format" && t.role === "agentSuffix").map((t) => t.promptText ?? "");
  return { prompt: prompts[prompts.length - 1] ?? "", spineGrew: trace.filter((t) => t.type === "spine:extend").length };
};
const twoFindings = [
  { text: TWO_TASKS, kind: "text" as const },
  { text: "FIRST-FINDING", kind: "report" as const },
  { text: "SECOND-FINDING", kind: "report" as const },
  { text: "the settled brief", kind: "text" as const },
];
const planned = (mode: "flat" | "deep") => [
  { send: { type: "submit_query" as const, query: "Q?", mode } },
  { on: (ev: WorkflowEvent) => ev.type === "ui:plan_review", send: accept },
  { on: (ev: WorkflowEvent) => ev.type === "complete" },
];

test("only the strategy replaced: an investigation run side by side still settles from what its inquiries found", async () => {
  // Whether the settling agent can already read the findings is a fact of the STRATEGY — the stock chain commits
  // each to the spine as it goes; `parallel` commits nothing — and never of the reader's choice of shape.
  const sideBySide: Research["write"] = (trunk, ask, plan) =>
    research.write(trunk, ask, plan, { inquire: (_ask, tasks, specFor) => parallel(tasks.map((task, i) => specFor(task, i, true))) });
  const run = await runHarness({ harness: composed({ ...research, write: sideBySide }), utterances: twoFindings, script: planned("deep") });
  const saw = settlingSaw(run);
  assert.equal(saw.spineGrew, 0, "this strategy commits nothing to the spine");
  assert.ok(saw.prompt.includes("FIRST-FINDING") && saw.prompt.includes("SECOND-FINDING"), "the settling agent was given nothing to settle");
});

test("a strategy that commits one of two identical findings has not attended both: the settling pass is still handed them", async () => {
  // Whether a finding is on the spine is a fact about THAT inquiry's finding, not about its text: two inquiries
  // can say the same words, and only the committed one is there to read.
  const firstOnly: Research["write"] = (trunk, ask, plan) =>
    research.write(trunk, ask, plan, {
      inquire: (_ask, tasks, specFor) => function* (ctx) {
        const agents: Agent[] = [];
        for (const [i, task] of tasks.entries()) agents.push(yield* ctx.spawn(specFor(task, i, true)));
        const first = yield* ctx.waitFor(agents[0]);
        if (first.result) yield* ctx.extendSpine(research.nextTask(tasks[0]), first.result);
        yield* ctx.waitFor(agents[1]);
      },
    });
  const run = await runHarness({
    harness: composed({ ...research, write: firstOnly }),
    utterances: [
      { text: TWO_TASKS, kind: "text" },
      { text: "THE-SAME-FINDING", kind: "report" },
      { text: "THE-SAME-FINDING", kind: "report" },
      { text: "the settled brief", kind: "text" },
    ],
    script: planned("flat"),
  });
  const saw = settlingSaw(run);
  assert.equal(saw.spineGrew, 1, "exactly one finding joined the spine");
  assert.ok(saw.prompt.includes("THE-SAME-FINDING"), "the finding the spine does not hold was not handed to the settling pass");
});

test("the stock strategies hand their findings over once: on the spine for an investigation, in the prompt for a survey", async () => {
  const deep = settlingSaw(await runHarness({ utterances: twoFindings, script: planned("deep") }));
  assert.equal(deep.spineGrew, 2, "each inquiry's findings joined the spine");
  assert.ok(!deep.prompt.includes("FIRST-FINDING"), "findings the spine already holds were said again in the prompt");
  const flat = settlingSaw(await runHarness({ utterances: twoFindings, script: planned("flat") }));
  assert.equal(flat.spineGrew, 0);
  assert.ok(flat.prompt.includes("FIRST-FINDING") && flat.prompt.includes("SECOND-FINDING"));
});

/** An output of the developer's own: another terminal tool, its findings in another argument. */
class FileFindings extends Tool<Record<string, unknown>> {
  readonly name = "file_findings";
  readonly description = "Hand in what you found.";
  readonly parameters: JsonSchema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
  readonly hooks: ToolLifecycleHooks = { onReturn: ({ args }) => ({ type: "accept", result: String((args as { summary?: unknown }).summary ?? "") }) };
  *execute(): Operation<unknown> { throw new Error("a terminal ends the turn; it is never dispatched"); }
}
const filed: Output<string> = { tool: new FileFindings(), read: (o) => o.result };

test("an output of the developer's own: another terminal, another argument, and the brief still reads and keeps the findings", async () => {
  const run = await runHarness({
    harness: composed({
      plan: onePlan,
      write: (trunk, ask, plan) => research.write(trunk, ask, plan, { output: filed }),
      reports: { tool: "file_findings", field: "summary" },
    }),
    terminal: { tool: "file_findings", field: "summary" },
    utterances: [{ text: "what was found", kind: "report" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const s = foldTo(run.events, "answer");
  const [section] = selectSections(s);
  assert.equal(section.prose, "what was found", "the section reads what the inquiry handed in");
  const agent = [...s.documents.get(s.activeDocId!)!.roster.agents.values()].find((a) => a.taskIndex === 0)!;
  assert.deepEqual(agent.timeline?.filter((t) => t.kind === "tool_call"), [], "handing in is the end of the turn, not a step of the work");
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  assert.match(fs.readFileSync(path.join(dir, "annexure-1.md"), "utf8"), /what was found/);
});

test("an output of the developer's own is what the inquiry is told to call: in its preamble, and in the recovery turn a reaped one is given", async () => {
  // The web, at the tool boundary: a search answers with one result, so the agent searches until the pool reaps it.
  WebSearchTool.prototype.execute = function* (args: { query: string }) {
    return { results: [{ title: `About ${args.query}`, url: `https://a.io/${args.query}`, snippet: `${args.query}, in brief` }] };
  } as typeof WebSearchTool.prototype.execute;
  let recovering = false;
  let n = 0;
  const search = (): Utterance => ({
    text: "", kind: "tool", tool: { name: "web_search", args: { query: `q${++n}` } }, stallTokens: 12,
    then: () => (recovering ? { text: "what was found", kind: "report" } : search()),
  });
  let reached: string[] = [];
  const run = await runHarness({
    harness: composed({
      plan: onePlan,
      write: (trunk, ask, plan) => research.write(trunk, ask, plan, { output: filed }),
      reports: { tool: "file_findings", field: "summary" },
    }),
    terminal: { tool: "file_findings", field: "summary" },
    instrument: (c) => { reached = c.formatChatCalls; },   // every prompt that reached the model, the recovery turn's included
    utterances: [search()],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => { if (ev.type === "agent:done") recovering = true; return ev.type === "agent:done"; } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "agent:recovered").length, 1, "the inquiry was reaped and recovered");
  // The template's own sentences: the recovery turn names the tool findings go through; the citation nudge is
  // about a `sources` argument this tool does not take, so it is not said at all. (A source's skill may name the
  // stock tool in its own words; that text is the ability's, not this app's.)
  const nudged = reached.filter((t) => /When you call \w+\(\):/.test(t));
  const recovery = reached.filter((t) => /must deliver findings now/.test(t));
  assert.equal(nudged.length, 0, "a tool that takes no sources was told how to fill them");
  assert.ok(recovery.length >= 1, "the recovery turn reached the model");
  for (const t of recovery) {
    assert.match(t, /Call the file_findings tool/, "the recovery turn names the inquiry's own output");
    assert.doesNotMatch(t, /Call the report tool/, "no recovery names a tool this run does not have");
  }
});

/** A store holding one document — a second participating source, so the stock planner probes coverage. */
function plantDocument(): { store: FileAttachmentStore; doc: Attachment } {
  const store = new FileAttachmentStore(fs.mkdtempSync(path.join(os.tmpdir(), "composition-scn-")));
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

test("stock planning with two sources leaves discovery behind: the planner drafts in `planning`, not as a third probe", async () => {
  // `preflight:start` moves the canvas to `discovering`; nothing moved it back except the later
  // `plan:start` — which is how ONE event came to own two jobs: opening the round, and ending
  // discovery. The round is the brief's now, so the end of discovery has to say so itself. Without
  // that, the status stays "Browsing your sources", the live outline never draws, and the planner is
  // folded as another source probe.
  const { store, doc } = plantDocument();
  const run = await runHarness({
    attachmentStore: store,
    utterances: [
      { text: "this source covers the question", kind: "text" },
      { text: "this source covers it too", kind: "text" },
      { text: TWO_TASKS, kind: "text" },
      { text: "first finding", kind: "report" },
      { text: "second finding", kind: "report" },
      { text: "the settled brief", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat", attachments: [doc] } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  assert.equal(run.events.filter((e) => e.type === "preflight:start").length, 1,
    "two sources should have drawn a cold coverage probe; this fixture no longer exercises it");

  let s: AppState = initialState;
  let atDiscoveryEnd: AppState | null = null;
  for (const ev of run.events) {
    s = reduce(s, ev);
    if (ev.type === "preflight:done") atDiscoveryEnd = s;
  }
  assert.ok(atDiscoveryEnd, "no preflight:done on the wire");
  const doc2 = atDiscoveryEnd!.documents.get(atDiscoveryEnd!.runDocId!)!;
  assert.equal(doc2.phase, "planning", "the canvas is still browsing sources while the planner writes the outline");
  assert.deepEqual(doc2.reconAgentIds, [], "the probe agents still hold the timeline the planner is about to draw into");
  assert.equal(doc2.roster.agents.size, 0, "the planner is not A0: the probes' roster survived into planning");
});

test("the dev tools see that same run as one run, in the order the wire says it: the probes are recon, the planner a planner", async () => {
  // The framing is data the app declares about its own wire, and nothing but this checks it against the wire.
  // Declared out of order, the pane reads a later marker as a NEW submission and wipes the run mid-flight.
  const { store, doc } = plantDocument();
  const run = await runHarness({
    attachmentStore: store,
    utterances: [
      { text: "this source covers the question", kind: "text" },
      { text: "this source covers it too", kind: "text" },
      { text: TWO_TASKS, kind: "text" },
      { text: "first finding", kind: "report" },
      { text: "second finding", kind: "report" },
      { text: "the settled brief", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat", attachments: [doc] } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "preflight:start").length, 1, "this fixture no longer draws a coverage probe");
  const m = createPaneModel();
  foldEvent(m, { type: "config:loaded", dev: true, config: {}, origin: {} } as DevEvent, 0, FRAMING);
  const starts = new Set<number>();
  run.events.forEach((ev, i) => {
    foldEvent(m, ev as unknown as DevEvent, i + 1, FRAMING);
    if (m.runStartAt !== null) starts.add(m.runStartAt);
  });
  assert.equal(starts.size, 1, `the pane started ${starts.size} runs for one submission`);
  assert.equal(m.spine?.query, "Q?", "the question survived the whole run");
  const roles = [...m.lanes.values()].map((l) => l.role);
  assert.deepEqual(roles.slice(0, 2), ["recon", "recon"], "the two probes wear recon");
  assert.equal(roles[2], "planner", "the planner that follows the probes wears planner, not recon");
  assert.deepEqual(roles.slice(3, 5), ["research", "research"], "the inquiries wear research");
});
