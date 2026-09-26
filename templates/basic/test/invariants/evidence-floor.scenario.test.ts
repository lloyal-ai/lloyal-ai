/**
 * An angle must read something before it may report.
 *
 * This is basic's one tool-lifecycle hook, and it is here because the failure it prevents is invisible: an
 * agent that reports without searching produces confident notes with no sources, the settling agent folds
 * them into a plausible article, and nothing anywhere says the page was invented. No type catches it and no
 * other test would fail.
 *
 * Refused ONCE, on purpose. The pool allows one rejected return per agent, so an angle that genuinely found
 * nothing can still say so on its second attempt — the floor makes the model look, it does not trap it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, typesOf } from "./harness.js";
import type { Utterance } from "./harness.js";
import { EVIDENCE_REJECTION } from "../../src/harness/wiki.js";

/** Both angles report without having called a single tool — exactly what the floor exists to refuse. */
const UNREAD: Utterance[] = [
  { kind: "report", text: "Angle one, from nowhere." },
  { kind: "report", text: "Angle two, from nowhere." },
  { kind: "text", text: "## An article built on nothing" },
];

/** The nudges the pool sent, with the words each agent was given in its result's place. */
const nudges = (trace: readonly { type?: string; message?: string }[]): string[] =>
  trace.filter((t) => t.type === "pool:agentNudge").map((t) => t.message ?? "");

test("an angle reporting with no tool calls behind it is refused, and told why", async () => {
  const run = await runHarness({
    utterances: UNREAD,
    script: [
      { send: { type: "submit_query", query: "did anyone actually read anything?" } },
      { on: (ev) => ev.type === "answer" },
    ],
  });

  const said = nudges(run.trace as { type?: string; message?: string }[]);
  assert.ok(
    said.includes(EVIDENCE_REJECTION),
    `the floor never fired — the model was never told to read first. Nudges seen: ${JSON.stringify(said)}`,
  );
});

test("the floor refuses once, not forever — a second report stands", async () => {
  // Were it to refuse every time, an angle that legitimately found nothing could never report at all and the
  // turn would hang until its turn cap. The answer arriving is the proof that it does not.
  const run = await runHarness({
    utterances: UNREAD,
    script: [
      { send: { type: "submit_query", query: "does the turn still finish?" } },
      { on: (ev) => ev.type === "answer" },
    ],
  });

  assert.ok(typesOf(run.events).includes("answer"), "the turn never completed — the floor is trapping agents");
});
