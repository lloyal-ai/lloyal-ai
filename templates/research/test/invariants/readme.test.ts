/** The README is a map, and a map that names a file which is not there is worse than none. Every source path it
 *  names in backticks must exist. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

test("every source path the README names exists", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const named = [...readme.matchAll(/`((?:src|test|docs|targets)\/[^`\s*<]*)`/g)].map((m) => m[1]);
  assert.ok(named.length > 10, "the README names its files");
  const missing = [...new Set(named)].filter((p) => !fs.existsSync(path.join(root, p)));
  assert.deepEqual(missing, [], "named in the README, not in the project");
});
