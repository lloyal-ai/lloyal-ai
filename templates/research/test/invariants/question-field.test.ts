/**
 * The question field holds a passage, not a line: Enter sends what is written, Shift+Enter breaks the line,
 * and an Enter that ends an input method's composition (choosing a kanji, say) is that method's, never a send.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sends } from "../../src/ui/parts/QuestionField.js";

const key = (over: Partial<{ key: string; shiftKey: boolean; isComposing: boolean }> = {}) =>
  ({ key: "Enter", shiftKey: false, isComposing: false, ...over });

test("Enter sends", () => {
  assert.equal(sends(key()), true);
});

test("Shift+Enter breaks the line instead", () => {
  assert.equal(sends(key({ shiftKey: true })), false);
});

test("an Enter that ends a composition is the input method's", () => {
  assert.equal(sends(key({ isComposing: true })), false);
});

test("any other key only types", () => {
  assert.equal(sends(key({ key: "a" })), false);
});
