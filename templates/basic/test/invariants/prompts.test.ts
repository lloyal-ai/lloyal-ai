/**
 * The prompts are FILES, and two things about that have to stay true.
 *
 * The frame is a contract: every system prompt hands itself to `framed.eta`, which is what makes
 * `instructions.ts` reach every agent that thinks. A file that forgets the header still renders — it just
 * silently stops saying who the app is for — so a test holds it rather than a convention.
 *
 * And an edit reaches the next question. That is the whole point of prompts being files: you change one and
 * ask again, with no restart and no rebuild.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { render } from "../../src/harness/prompts.js";

const DIR = path.join(process.cwd(), "src/harness/prompts");
const systemFiles = fs.readdirSync(DIR).filter((f) => f.endsWith(".system.eta"));

test("every system prompt opens with the frame", () => {
  assert.ok(systemFiles.length > 0, `no *.system.eta found in ${DIR}`);
  for (const file of systemFiles) {
    const first = fs.readFileSync(path.join(DIR, file), "utf8").split("\n")[0];
    assert.match(
      first,
      /^<% layout\("\.\/framed", \{ writesTheAnswer: (true|false|it\.writesTheAnswer) \}\) %>$/,
      `${file} does not open with the layout directive — it would not hear instructions.ts`,
    );
  }
});

test("as shipped, the frame adds nothing: an empty identity is silence, not blank lines", () => {
  // `instructions.ts` ships empty, so a framed prompt must render to exactly its own body.
  const body = fs.readFileSync(path.join(DIR, "synthesize.system.eta"), "utf8")
    .split("\n").slice(1).join("\n").trim();
  assert.equal(render("synthesize.system"), body);
});

test("an edit to a prompt reaches the next render — no restart", () => {
  const name = `probe-${process.pid}`;
  const file = path.join(DIR, `${name}.eta`);
  try {
    fs.writeFileSync(file, "first");
    assert.equal(render(name), "first");
    fs.writeFileSync(file, "second");
    assert.equal(render(name), "second", "the prompt was cached — an edit would need a restart to be heard");
  } finally {
    fs.rmSync(file, { force: true });
  }
});
