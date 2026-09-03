/**
 * The KV law, end to end on the real harness: at most one document-owned
 * trunk exists; a document boundary releases the outgoing trunk; an ask on
 * the same document appends to the same trunk. `docs/document-identity.md`
 * states these laws — this file walks them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runHarness, typesOf, warmDeltas, prunesOf, sessionReleasesOf, docIdOfQuery,
} from "./harness.js";

test("boot: config → abilities → weights:done, and nothing touches the KV", async () => {
  const run = await runHarness();
  const types = typesOf(run.events);
  // config:loaded and weights:done ride the bus directly (sync); the
  // abilities snapshot rides the agent-event forwarder (async), so it lands
  // after weights:done. That asymmetry is the two-bus seam, visible.
  assert.deepEqual(types.filter((t) => ["config:loaded", "abilities:state", "weights:done"].includes(t)),
    ["config:loaded", "weights:done", "abilities:state"]);
  assert.equal(warmDeltas(run.trace).length, 0);
});

test("cold ask: birth → settle commits ONE turn to a fresh trunk; the report lands on disk", async () => {
  const run = await runHarness({
    utterances: [{ text: "Honey never spoils because of low water activity.", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Why is honey durable?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  // The wire, in order: the echo births the doc, the synthetic plan frames
  // it, one agent researches, the answer settles it.
  const types = typesOf(run.events);
  const order = ["query", "plan:start", "plan", "research:start", "answer", "complete"];
  const positions = order.map((t) => types.indexOf(t));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `wire order: ${types.join(" → ")}`);
  const query = run.events.find((e) => e.type === "query") as { warm: boolean; docId: string };
  assert.equal(query.warm, false);

  // The KV: exactly one turn committed, to a trunk that was never released.
  const deltas = warmDeltas(run.trace);
  assert.equal(deltas.length, 1);
  assert.ok(deltas[0].content?.includes("Honey never spoils"));
  assert.equal(sessionReleasesOf(run, deltas[0].branchHandle!).length, 0);

  // The disk: the folder IS the docId.
  const report = path.join(run.outputDir, docIdOfQuery(run.events), "report.md");
  assert.ok(fs.existsSync(report), `expected ${report}`);
  assert.ok(fs.readFileSync(report, "utf8").includes("Honey never spoils"));
});

test("warm ask: threads the SAME trunk — a second turn, zero releases, an exchange on disk", async () => {
  const run = await runHarness({
    utterances: [
      { text: "First answer.", kind: "text" },
      { text: "Follow-up answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "First?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete", send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  // One identity end to end: the second echo is warm, same docId.
  assert.equal(docIdOfQuery(run.events, 1), docIdOfQuery(run.events, 0));
  const second = run.events.filter((e) => e.type === "query")[1] as { warm: boolean };
  assert.equal(second.warm, true);

  // Two commits, ONE trunk, zero releases — the ask appended.
  const deltas = warmDeltas(run.trace);
  assert.equal(deltas.length, 2);
  assert.equal(deltas[1].branchHandle, deltas[0].branchHandle);
  assert.equal(sessionReleasesOf(run, deltas[0].branchHandle!).length, 0);

  // The thread on disk: report + exchange beside it.
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  assert.ok(fs.existsSync(path.join(dir, "report.md")));
  const exchanges = fs.readdirSync(dir).filter((f) => /^exchange-\d+\.md$/.test(f));
  assert.equal(exchanges.length, 1);
});

test("document boundary: a new doc RELEASES the old trunk and births its own", async () => {
  const run = await runHarness({
    utterances: [
      { text: "Doc A's answer.", kind: "text" },
      { text: "Doc B's answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "A?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete", send: { type: "new_run" } },
      { on: (ev) => ev.type === "doc:active" && (ev as { docId: string | null }).docId === null,
        send: { type: "submit_query", query: "B?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });

  // Two documents, two identities.
  const a = docIdOfQuery(run.events, 0);
  const b = docIdOfQuery(run.events, 1);
  assert.notEqual(a, b);

  // The law: A's trunk was PRUNED at the boundary; B's turn sits on a new
  // handle; at no point did two document trunks coexist.
  const deltas = warmDeltas(run.trace);
  assert.equal(deltas.length, 2);
  const [aCommit, bCommit] = deltas;
  assert.notEqual(bCommit.branchHandle, aCommit.branchHandle);
  assert.equal(sessionReleasesOf(run, aCommit.branchHandle!).length, 1, "A's trunk was released exactly once");
  assert.equal(sessionReleasesOf(run, bCommit.branchHandle!).length, 0, "B's trunk lives to shutdown");
  // The release happened BEFORE B's commit — the boundary order.
  const releaseIdx = run.trace.findIndex(
    (t) => t.type === "branch:prune" && (t as { branchHandle?: number }).branchHandle === aCommit.branchHandle,
  );
  assert.ok(releaseIdx > run.trace.indexOf(aCommit) && releaseIdx < run.trace.indexOf(bCommit));

  // Both briefs settled on disk under their own ids.
  assert.ok(fs.existsSync(path.join(run.outputDir, a, "report.md")));
  assert.ok(fs.existsSync(path.join(run.outputDir, b, "report.md")));
});
