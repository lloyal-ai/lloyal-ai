/**
 * A command nobody handles is a VIEW wired to something this app never offered — a different fact from a
 * handler that threw, and the reader's run is none of its business.
 *
 * Worth a test because the old loop got this wrong in the quietest possible way: `for (const cmd of yield*
 * each(commands))` with an `if` per type simply fell through, so a surface sending a command the harness had
 * dropped got silence, and the bug lived on the view's side of the wire where nothing would look for it.
 * `serveDefaults` says it on the wire instead, and says it without touching the run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, typesOf } from "./harness.js";
import type { Command } from "../../src/protocol.js";

test("an unknown command is said on the wire, and the session carries on", async () => {
  const run = await runHarness({
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## The article" },
    ],
    script: [
      // Deliberately off-contract — the cast is the point of the test, standing in for a view built against
      // a newer protocol than the harness it is talking to.
      { send: { type: "wrap_up" } as unknown as Command },
      { on: (ev) => ev.type === "ui:error", send: { type: "submit_query", query: "still working?" } },
      { on: (ev) => ev.type === "answer" },
    ],
  });

  const toast = run.events.find((e) => e.type === "ui:error") as { message: string } | undefined;
  assert.ok(toast, `nothing was said about the unknown command: ${typesOf(run.events).join(", ")}`);
  assert.match(toast.message, /wrap_up/, "the toast should name the command nobody handles");
  assert.ok(
    !typesOf(run.events).includes("run:aborted"),
    "an unhandled command must not end a turn — there was no turn to end",
  );

  const answers = run.events.filter((e) => e.type === "answer") as { text: string }[];
  assert.equal(answers[0]?.text, "## The article", "the session should still answer afterwards");
});
