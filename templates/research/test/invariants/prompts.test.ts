/**
 * The prompts are files Eta reads, and the frame is one file every system prompt hands itself to. Two contracts
 * a reader could break without noticing: a system file that forgets the layout header ships unframed, and the
 * frame's words come from `instructions.ts` alone. Bytes are the byte proof's business (`test/prompt-bytes`);
 * this holds the shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { INSTRUCTIONS } from "../../src/research/instructions.js";
import { prompt, render } from "../../src/research/prompts.js";

const DIR = path.join(process.cwd(), "src/research/prompts");
const systemFiles = fs.readdirSync(DIR).filter((f) => f.endsWith(".system.eta")).sort();

test("every system prompt opens by handing itself to the one frame", () => {
  assert.ok(systemFiles.length >= 8, `expected the system files, found ${systemFiles.length}`);
  for (const f of systemFiles) {
    const first = fs.readFileSync(path.join(DIR, f), "utf8").split("\n")[0];
    assert.match(first, /^<% layout\("\.\/framed", \{ writesTheAnswer: (true|false|it\.writesTheAnswer) \}\) %>$/, `${f} does not open with the layout`);
  }
});

/** Run `body` with the instructions set, restoring the shipped (empty) ones after. */
const instructed = <T>(purpose: string, answers: string, body: () => T): T => {
  const shipped = { ...INSTRUCTIONS };
  Object.assign(INSTRUCTIONS, { purpose, answers });
  try { return body(); } finally { Object.assign(INSTRUCTIONS, shipped); }
};

test("the frame says the purpose first and, only where the answer is written, what answers must do last", () => {
  instructed("PURPOSE.", "ANSWERS.", () => {
    // A stage that writes the reader's answer: purpose, its own text, answers.
    const settling = prompt("synthesize", { query: "Q" }).systemPrompt;
    assert.ok(settling.startsWith("PURPOSE.\n\nYou are writing"), settling.slice(0, 60));
    assert.ok(settling.endsWith("\n\nANSWERS."), settling.slice(-40));
    // A stage that does not: purpose and its own text, nothing after.
    const planning = prompt("plan-flat", { query: "Q", count: 2, context: null, routingKey: "ability", date: "D", sources: [], coverage: "" }).systemPrompt;
    assert.ok(planning.startsWith("PURPOSE.\n\nYou're a research planner"));
    assert.ok(!planning.includes("ANSWERS."));
    // The direct answer's frame is the frame alone.
    assert.equal(render("answer.system"), "PURPOSE.\n\nANSWERS.");
    // An inquiry hears the answer requirements only when it is the answer.
    assert.ok(render("inquiry.system", { preamble: "P", tool: "report", takesSources: false, writesTheAnswer: true }).endsWith("ANSWERS."));
    assert.ok(!render("inquiry.system", { preamble: "P", tool: "report", takesSources: false, writesTheAnswer: false }).includes("ANSWERS."));
  });
  // As shipped, the frame adds nothing: the direct answer's system prompt is empty.
  assert.equal(render("answer.system"), "");
});

test("the citation partial is said of the inquiry's own report tool, and only when it takes sources", () => {
  const cited = render("inquiry.system", { preamble: "P", tool: "file_findings", takesSources: true, writesTheAnswer: false });
  assert.ok(cited.includes("When you call file_findings(): cite each claim inline"));
  assert.ok(!render("inquiry.system", { preamble: "P", tool: "file_findings", takesSources: false, writesTheAnswer: false }).includes("When you call"));
});

test("the clarify turn numbers the planner's questions", () => {
  assert.equal(render("clarify", { questions: ["Which one?", "By when?"] }), "I need to clarify a few things before researching:\n\n1. Which one?\n2. By when?");
});
