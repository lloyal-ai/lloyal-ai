/**
 * The text a rendered node reads as. A cited moment's spoken name is built
 * from it, so the words a model wrote in bold or code must reach a screen
 * reader, not only the playback instruction beside them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { textOf } from "../../src/ui/text-of.js";

test("plain text and numbers read as themselves", () => {
  assert.equal(textOf("The collision"), "The collision");
  assert.equal(textOf(["at ", 5, "s"]), "at 5s");
});

test("formatted text reads through the elements that wrap it", () => {
  assert.equal(textOf(createElement("strong", null, "The collision")), "The collision");
  assert.equal(textOf(["See ", createElement("em", null, ["the ", createElement("code", null, "red")]), " square"]), "See the red square");
});

test("nothing that renders no text reads as any", () => {
  assert.equal(textOf(null), "");
  assert.equal(textOf(undefined), "");
  assert.equal(textOf(true), "");
});
