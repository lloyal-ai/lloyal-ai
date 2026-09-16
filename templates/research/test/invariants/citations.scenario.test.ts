/**
 * Inline citations are research's invariant: a report's grammar-forced
 * `sources` are woven into its findings at capture, so the synth reads — and
 * mirrors — cited findings. Pinned at the seam, over the real pool and the
 * real policy, so the recut and the migration cannot drop it unnoticed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { WebSearchTool } from "../../node_modules/@lloyal-labs/web-ability/dist/tools/web-search.js";
import { runHarness, docIdOfQuery, accept } from "./harness.js";
import type { Utterance } from "./harness.js";

/** The web, at the tool boundary: a search answers with one result, so an agent can search as long as its turns last. */
WebSearchTool.prototype.execute = function* (args: { query: string }) {
  return { results: [{ title: `About ${args.query}`, url: `https://a.io/${args.query}`, snippet: `${args.query}, in brief` }] };
} as typeof WebSearchTool.prototype.execute;

const PLAN_JSON = JSON.stringify({
  intent: "research",
  tasks: [{ description: "investigate the topic" }],
  clarifyQuestions: [],
});
const FINDINGS = "Oslo sits on the fjord, see https://a.io/oslo and https://a.io.";
const SOURCES = [{ title: "A", url: "https://a.io" }, { title: "Oslo", url: "https://a.io/oslo" }];
const WOVEN = "Oslo sits on the fjord, see [Oslo](https://a.io/oslo) and [A](https://a.io).\n\nSources:\n- [Oslo](https://a.io/oslo)\n- [A](https://a.io)";

test("a voluntary report's sources are woven into its findings: on the wire, and in the annexure on disk", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: FINDINGS, kind: "report", sources: SOURCES },
      { text: "Settled answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const returns = run.events.filter((e) => e.type === "agent:return") as { result: string }[];
  assert.equal(returns.length, 1);
  assert.equal(returns[0].result, WOVEN);
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  const annexures = fs.readdirSync(dir).filter((f) => /^annexure-\d+\.md$/.test(f));
  assert.equal(annexures.length, 1, "one annexure per research agent");
  const body = fs.readFileSync(path.join(dir, annexures[0]), "utf8");
  assert.ok(body.includes("[Oslo](https://a.io/oslo)") && body.includes("Sources:"), "the annexure carries the woven findings");
});

test("a recovered report's sources are woven the same way — the recovery turn passes through the return position", async () => {
  // The agent searches on every turn until the pool reaps it at the turn cap; its recovery turn is the report.
  let recovering = false;
  let n = 0;
  const search = (): Utterance => ({
    text: "", kind: "tool", tool: { name: "web_search", args: { query: `q${++n}` } }, stallTokens: 12,
    then: () => (recovering ? { text: FINDINGS, kind: "report", sources: SOURCES } : search()),
  });
  const run = await runHarness({
    utterances: [{ text: PLAN_JSON, kind: "text" }, search()],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "research:start" },
      { on: (ev) => { if (ev.type === "agent:done") recovering = true; return ev.type === "agent:done"; } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "agent:return").length, 0, "the agent never returned on its own");
  const recovered = run.events.filter((e) => e.type === "agent:recovered") as { result: string }[];
  assert.equal(recovered.length, 1, "one recovered report");
  assert.equal(recovered[0].result, WOVEN, "woven at capture, the same as a voluntary return");
  assert.ok(n >= 2, "the agent searched before it was reaped");
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  const annexures = fs.readdirSync(dir).filter((f) => /^annexure-\d+\.md$/.test(f));
  assert.equal(annexures.length, 1);
  assert.ok(fs.readFileSync(path.join(dir, annexures[0]), "utf8").includes("[Oslo](https://a.io/oslo)"), "the annexure carries the woven findings");
});
