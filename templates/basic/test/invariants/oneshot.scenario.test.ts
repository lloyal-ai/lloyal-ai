/**
 * A terminal with nobody at it: one question, and the run's outcome is the exit code.
 *
 * This is the only path into basic that is not a person typing, so it is what a script, a CI job or a shell
 * pipeline gets. It differs from the command loop in one way that matters: nobody can stop this run, so the
 * harness waits for it rather than returning as soon as it is accepted — and its failure is the process's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, typesOf } from "./harness.js";
import { HarnessExit } from "@lloyal-labs/rig";

test("one question, answered, and the run is waited for", async () => {
  const run = await runHarness({
    oneshot: "are solid-state batteries ready?",
    utterances: [
      { kind: "report", text: "Angle one." },
      { kind: "report", text: "Angle two." },
      { kind: "text", text: "## Settled without a reader" },
    ],
  });

  const answer = run.events.find((e) => e.type === "answer") as { text: string | null } | undefined;
  assert.ok(answer, `no answer on the wire: ${typesOf(run.events).join(", ")}`);
  assert.equal(answer.text, "## Settled without a reader");
  assert.equal(run.failure, undefined, "a run that answered must not also report a failure");
});

test("no question to run: the harness exits, it does not hang waiting for one", async () => {
  // The interactive path would simply wait for a command. With nobody there, waiting IS the bug — so the
  // harness says what is missing and exits with a code a script can act on.
  const run = await runHarness({ oneshot: "" });

  assert.ok(run.failure instanceof HarnessExit, `expected a HarnessExit, got ${String(run.failure)}`);
  assert.equal((run.failure as HarnessExit).exitCode, 2);
  assert.match((run.failure as HarnessExit).message, /--query/);
});
