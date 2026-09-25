/**
 * The platform's events ride the harness's stream beside its own — the install's steps, trace and
 * host-resource events — through this same reducer. The reducer must return its state unchanged for an event
 * it does not know: the platform reads those events from the stream, never from the fold, and a reducer that
 * rejected them would take the run down on the first one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce } from "../../src/ui/state.js";
import type { WorkflowEvent } from "../../src/protocol.js";

const platformEvents = [
  { type: "install:step", steps: [{ id: "llm", label: "Downloading the reasoning model", status: "running", got: 1, total: 2 }] },
  { type: "install:step", steps: [] },
  { type: "trace", event: { type: "pool:agentNudge" } },
  { type: "platform:event-this-harness-has-never-heard-of" },
];

test("an event the harness does not know leaves its state untouched — the same reference, not a copy", () => {
  for (const ev of platformEvents) {
    assert.equal(reduce(initialState, ev as unknown as WorkflowEvent), initialState, `${ev.type} changed the state`);
  }
});
