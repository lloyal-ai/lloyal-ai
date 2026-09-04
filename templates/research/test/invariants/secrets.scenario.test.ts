/**
 * Secrets never ride the bus. On a served placement the event bus terminates
 * in EVERY connected tenant's renderer — so an ability credential appearing
 * in any event, ever, is a leak. This sweeps the whole wire, not one event
 * shape: the assertion survives new event types by construction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness } from "./harness.js";

const SECRET = "tvly-SECRET-do-not-ship-9f2c7a";

test("a configured ability credential appears in NO event on the wire", async () => {
  const run = await runHarness({
    config: {
      version: 1,
      sources: {},
      abilities: { web: { tavilyKey: SECRET } },
      defaults: { reasoningMode: "flat", effort: "low", maxTurns: 4 },
      model: {},
    },
    script: [
      // config:updated carries the whole config back out — the second place
      // redaction must hold (config:loaded at boot is the first).
      { send: { type: "set_effort", effort: "medium" } },
      { on: (ev) => ev.type === "config:updated" },
    ],
  });

  for (const ev of run.events) {
    const wire = JSON.stringify(ev);
    assert.ok(!wire.includes(SECRET), `secret leaked in a '${ev.type}' event`);
  }

  // And the redaction is presence-shaped, not deletion: a surface can still
  // see THAT a key is configured.
  const loaded = run.events.find((e) => e.type === "config:loaded") as {
    config: { abilities: Record<string, Record<string, unknown>> };
  };
  assert.equal(loaded.config.abilities.web?.tavilyKey, true);
});
