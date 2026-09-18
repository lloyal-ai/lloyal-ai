/** The numbers a brief obeys hold one relation the reader never sees but a loop would: every pass has a clock.
 *  The settling pass's clock is the longest, since it must outlast the longest research it settles. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGETS } from "../../src/research/budgets.js";

test("every pass that can think has a clock, and the settling pass's is the longest", () => {
  const settle = BUDGETS.settle.time.hardLimit;
  assert.ok(settle > 0, "the settling pass has no clock: a loop would run the context out");
  for (const [name, row] of Object.entries(BUDGETS.effort)) {
    assert.ok(row.time.hardLimit > 0, `${name} has no clock`);
    assert.ok(settle >= row.time.hardLimit, `${name}'s research may outlast the settle that must follow it`);
  }
  assert.ok(BUDGETS.recon.time.hardLimit > 0, "recon has no clock");
});
