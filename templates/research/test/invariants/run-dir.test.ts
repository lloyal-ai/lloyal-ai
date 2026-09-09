/**
 * The run dir is shared by every session on a document: served sessions each
 * own a RunDirSink over the same library. An annexure name is therefore a
 * RESERVATION, not an observation — two sinks asking the same document at
 * once must never write over each other's evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RunDirSink } from "../../harness/run-dir.js";
import type { WorkflowEvent } from "../../harness/events.js";

const ev = (e: Record<string, unknown>): WorkflowEvent => e as unknown as WorkflowEvent;

test("two sinks on one document reserve distinct annexure names", () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "run-dir-"));
  const dir = path.join(lib, "2026-01-01T00-00-00-000");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "report.md"), "# Q?\n\n> 2026-01-01T00:00:00.000Z · flat\n\nbody\n");
  fs.writeFileSync(path.join(dir, "annexure-1.md"), "# Annexure 1\n\n---\n\nold\n");

  const a = new RunDirSink();
  const b = new RunDirSink();
  a.startThread({ dir, query: "from A", mode: "flat" });
  b.startThread({ dir, query: "from B", mode: "flat" });   // same document, same moment
  for (const s of [a, b]) s.handle(ev({ type: "research:start" }));
  a.handle(ev({ type: "agent:spawn", agentId: 11 }));
  b.handle(ev({ type: "agent:spawn", agentId: 22 }));
  a.handle(ev({ type: "agent:return", agentId: 11, result: "A's evidence" }));
  b.handle(ev({ type: "agent:return", agentId: 22, result: "B's evidence" }));

  const written = fs.readdirSync(dir).filter((n) => /^annexure-\d+\.md$/.test(n)).sort();
  assert.deepEqual(written, ["annexure-1.md", "annexure-2.md", "annexure-3.md"]);
  const bodies = written.map((n) => fs.readFileSync(path.join(dir, n), "utf8"));
  assert.ok(bodies.some((t) => /A's evidence/.test(t)));
  assert.ok(bodies.some((t) => /B's evidence/.test(t)));
});

test("roots a tool result admitted ride the meta line beside the query's own, once each", () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "run-dir-"));
  const dir = path.join(lib, "2026-01-01T00-00-00-000");
  const own = "sha256:" + "a".repeat(64);
  const admitted = "sha256:" + "b".repeat(64);

  const sink = new RunDirSink();
  sink.start({ dir, query: "Q?", mode: "flat", attachments: [own] });
  // A tool admitted a root mid-run — and re-admitted the query's own, which
  // is one entry, not two. The admission arrives as the bus event the pool
  // announces it with, the same stream every other run-record fact rides.
  const root = (digest: string) => ({ mediaType: "application/vnd.oci.image.manifest.v1+json", digest, size: 700 });
  sink.handle(ev({ type: "agent:prefilled", agentId: 3, cells: 1629, role: "toolResult", attachments: [root(admitted), root(own)] }));
  sink.handle(ev({ type: "answer", text: "the answer" }));
  sink.handle(ev({ type: "complete", data: { wallTimeMs: 1, planMs: 0, researchMs: 0, synthMs: 0, passthroughMs: 0 } }));

  const meta = fs.readFileSync(path.join(dir, "report.md"), "utf8").split("\n")[2] ?? "";
  assert.ok(meta.includes(`media ${own} ${admitted}`), meta);
  assert.equal(meta.split(own).length - 1, 1);
});
