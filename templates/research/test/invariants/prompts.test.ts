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
import { parseAttachmentMoment } from "@lloyal-labs/media";
import { linksOf } from "@lloyal-labs/ui/prose";
import { INSTRUCTIONS } from "../../src/harness/instructions.js";
import { PROMPTS as DIR, prompt, render } from "../../src/harness/prompts.js";

const systemFiles = fs.readdirSync(DIR).filter((f) => f.endsWith(".system.eta")).sort();

/**
 * Every prompt's input, as its caller gives it: the one table a newcomer reads to know what a file receives.
 * Rendered under a watcher that throws, so a key a file reads that its input does not name fails HERE — before
 * any model is loaded — for the rare paths too (a typo in `recovery` is otherwise met only when an agent is
 * reaped). At run time the same miss is a line in the engine's log and an empty string, never a lost run.
 */
const INPUTS: Record<string, Record<string, unknown>> = {
  "answer.system": {},
  "clarify": { questions: ["one?", "two?"] },
  "inquiry.system": { preamble: "the source's preamble", takesSources: true, writesTheAnswer: false, tool: "report" },
  "plan": { query: "Q?", count: 3, date: "2026-01-01", routingKey: "ability", sources: [{ name: "web", useWhen: "for the web", toc: null }], coverage: null },
  "plan-flat": { query: "Q?", count: 3, date: "2026-01-01", routingKey: "ability", sources: [], coverage: null },
  "preflight": { query: "Q?", ability: { name: "web", useWhen: "for the web", tools: ["web_search"], contents: null } },
  "preflight-recover": { budget: 120 },
  "recovery": { budget: 120, tool: "report", writesTheAnswer: true },
  "synthesize": { query: "Q?", findings: [{ task: "the task", body: "what the spine could not hold" }] },
  "synthesize-flat": { query: "Q?", findings: [{ task: "the task", body: "what was found" }] },
  "video-addresses": { videos: [{ n: 1, at: "attachment://e8befb123f1b" }, { n: 2, at: "attachment://66b1d44fbe7f" }] },
};
const strict = ({ prompt, key }: { prompt: string; key: string }): never => { throw new Error(`${prompt}: input "${key}" is not given`); };

test("every prompt renders from its declared input, and reads no key the input does not name", () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".eta") && !["framed.eta", "cite.eta", "moment.eta"].includes(f)).map((f) => f.replace(/\.eta$/, ""));
  for (const file of files) {
    const name = file.replace(/\.(system|user)$/, "");
    const input = INPUTS[file] ?? INPUTS[name];
    assert.ok(input, `${file} has no declared input in this table`);
    assert.doesNotThrow(() => render(file, input, { onMissing: strict }), `${file} reads a key its input does not name`);
  }
});

test("at run time a missing input is reported and rendered empty — never the word undefined, never a lost run", () => {
  const misses: string[] = [];
  const out = render("synthesize.user", {}, { onMissing: ({ prompt, key }) => misses.push(`${prompt}.${key}`) });
  assert.equal(misses.join(","), "synthesize.user.eta.query,synthesize.user.eta.findings");
  assert.ok(!out.includes("undefined"));
});

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
    const settling = prompt("synthesize", { query: "Q", findings: [] }).systemPrompt;
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

test("the next render reads edits to a prompt, its layout, and its partial", () => {
  const name = `reload-${process.pid}`;
  const files = [name, `${name}-layout`, `${name}-partial`].map((part) => path.join(DIR, `${part}.eta`));
  const body = (text: string) => `<% layout("./${name}-layout") %>${text}:<%~ include("./${name}-partial") %>`;
  try {
    fs.writeFileSync(files[0], body("first"));
    fs.writeFileSync(files[1], "layout:[<%~ it.body %>]");
    fs.writeFileSync(files[2], "partial");
    assert.equal(render(name), "layout:[first:partial]");
    fs.writeFileSync(files[0], body("second"));
    assert.equal(render(name), "layout:[second:partial]");
    fs.writeFileSync(files[1], "edited:[<%~ it.body %>]");
    assert.equal(render(name), "edited:[second:partial]");
    fs.writeFileSync(files[2], "changed");
    assert.equal(render(name), "edited:[second:changed]");
  } finally {
    for (const file of files) fs.rmSync(file, { force: true });
  }
});

test("each attached video is named by its address, with the form a moment in it is cited in", () => {
  assert.equal(render("video-addresses", INPUTS["video-addresses"]), [
    "Video 1 is attachment://e8befb123f1b. Cite a moment in it as a link whose text is the time the video marks at that moment, written as the video writes it, and whose address is attachment://e8befb123f1b/t/ followed by that same time: [time](attachment://e8befb123f1b/t/time).",
    "Video 2 is attachment://66b1d44fbe7f. Cite a moment in it as a link whose text is the time the video marks at that moment, written as the video writes it, and whose address is attachment://66b1d44fbe7f/t/ followed by that same time: [time](attachment://66b1d44fbe7f/t/time).",
  ].join("\n"));
});

/** Every text that says how a moment is cited: the question's address line, the inquiry's citation partial,
 *  and the settling passes. */
const MOMENT_SAYERS: [string, object][] = [
  ["video-addresses", INPUTS["video-addresses"]],
  ["inquiry.system", { preamble: "P", tool: "report", takesSources: true, writesTheAnswer: false }],
  ["synthesize.system", INPUTS["synthesize"]],
  ["synthesize-flat.system", INPUTS["synthesize-flat"]],
];

test("a moment's form is said in one place, and the example it shows can never be cited as a moment", () => {
  const form = "a link whose text is the time the video marks at that moment, written as the video writes it";
  for (const [name, input] of MOMENT_SAYERS) {
    const text = render(name, input);
    assert.ok(text.includes(form), `${name} says the moment's form`);
    const moments = linksOf(text).map((l) => l.href).filter((href) => href.includes("/t/"));
    assert.ok(moments.length > 0, `${name} shows the form`);
    for (const href of moments) assert.equal(parseAttachmentMoment(href), null, `${name}: its example ${href} would play if copied`);
  }
  for (const name of ["synthesize", "synthesize-flat"]) {
    assert.ok(!render(`${name}.system`, INPUTS[name]).includes("example.com"), `${name}: no worked example a model can copy as a source`);
  }
});
