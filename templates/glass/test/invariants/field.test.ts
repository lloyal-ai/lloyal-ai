import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, emptyWork, reduce } from "../../src/ui/state.js";
import { inquiryLights } from "../../src/ui/field.js";
test("ambient activity follows actual inquiries, not decisions or proposed plan rows", () => {
  let state = {
    ...initialState,
    activeId: "one",
    work: emptyWork("one", "turn"),
  };
  state.work.phase = "working";
  assert.deepEqual(inquiryLights(state), []);
  state = reduce(state, {
    type: "agent:spawn",
    agentId: 1,
    key: "decision",
  }) as typeof state;
  assert.deepEqual(inquiryLights(state), []);
  state = reduce(state, {
    type: "agent:spawn",
    agentId: 2,
    key: "answer",
  }) as typeof state;
  assert.deepEqual(inquiryLights(state), [{ id: 2, state: "reading" }]);
  state = reduce(state, {
    type: "agent:done",
    agentId: 2,
    reason: "max_tokens",
  }) as typeof state;
  assert.deepEqual(inquiryLights(state), [{ id: 2, state: "cooling" }]);
  state = reduce(state, {
    type: "agent:recovered",
    agentId: 2,
    result: "Recovered",
  }) as typeof state;
  assert.deepEqual(inquiryLights(state), [{ id: 2, state: "settling" }]);
  state = reduce(state, { type: "work:paused", paused: true }) as typeof state;
  assert.deepEqual(inquiryLights(state), [{ id: 2, state: "still" }]);
  assert.deepEqual(inquiryLights({ ...state, activeId: "other" }), []);
});
