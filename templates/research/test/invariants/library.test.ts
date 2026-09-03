/**
 * The library's disk reads are confined: a client-supplied path resolves to
 * a report inside the library, and everything read BESIDE that report is
 * held to the same rule. A planted symlink named like an exchange must not
 * pull a file from outside the run dir onto the wire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { confinedReport, readThread } from "../../harness/library.js";

const REPORT = "# Q?\n\n> 2026-01-01T00:00:00.000Z · flat · 1.0s\n\nThe body.\n";
const EXCHANGE = "# Follow-up?\n\n> 2026-01-01T00:01:00.000Z · flat · 1.0s\n\nThe follow-up body.\n";

test("readThread ignores an exchange whose real path lies outside the run dir", () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
  const run = path.join(lib, "2026-01-01T00-00-00-000");
  fs.mkdirSync(run);
  fs.writeFileSync(path.join(run, "report.md"), REPORT);
  fs.writeFileSync(path.join(run, "exchange-1.md"), EXCHANGE);            // a real exchange
  fs.writeFileSync(path.join(outside, "secret.md"), "# leaked\n\n> x\n\nSECRET\n");
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(run, "exchange-2.md")); // a planted one

  const reportPath = confinedReport(lib, path.join(run, "report.md"));
  assert.ok(reportPath);
  const thread = readThread(reportPath);
  assert.equal(thread.exchanges.length, 1);
  assert.equal(thread.exchanges[0].question, "Follow-up?");
  assert.doesNotMatch(thread.thread, /SECRET/);
});
