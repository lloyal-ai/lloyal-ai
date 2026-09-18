/** Every key the app declares says what it is, in its own words: that sentence is what the dev pane shows beside
 *  the key, and the only place it lives. How a change applies and where it is set are the declaration's other
 *  fields, so the sentence says neither. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config.js";
import type { ConfigKey } from "@lloyal-labs/rig";

test("every declared key describes itself, and leaves the how to its tier and its yml path", () => {
  for (const [key, decl] of Object.entries(config) as [string, ConfigKey][]) {
    assert.match(decl.describe ?? "", /\S.*\.$/, `${key} says nothing of itself`);
    assert.doesNotMatch(decl.describe!, /harness\.yml|restart|next run/i, `${key} says how, which is not its sentence's to say`);
  }
});
