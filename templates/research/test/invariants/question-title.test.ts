/**
 * A document's question is its heading only while it reads as one: fewer than three lines at heading size, at the
 * width it is shown in. Anything longer, a pasted passage, is the reader's words at reading size instead. The lines
 * are counted from the question laid out at heading size, so the rule is the page's own measure, never a guess at
 * characters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readsAsHeading } from "../../src/ui/parts/QuestionTitle.js";

/** One line of the heading: 31px at a line height of 1.22. */
const LINE = 31 * 1.22;

test("one line is a heading", () => {
  assert.equal(readsAsHeading(LINE, LINE), true);
});

test("two lines are a heading", () => {
  assert.equal(readsAsHeading(2 * LINE, LINE), true);
});

test("three lines are read at reading size", () => {
  assert.equal(readsAsHeading(3 * LINE, LINE), false);
});

test("a height a fraction off whole lines counts the lines it holds", () => {
  assert.equal(readsAsHeading(2 * LINE + 0.6, LINE), true);
  assert.equal(readsAsHeading(3 * LINE - 0.6, LINE), false);
});
