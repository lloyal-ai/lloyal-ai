/** The README and AGENTS.md are maps, and a map that names a file which is not there is worse than none. Every source path it
 *  names in backticks must exist. This is not pedantry: the shape block described `src/harness/harness.ts` and
 *  `ui/streaming.ts` for a while after both had gone, and nothing anywhere said so. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

for (const file of ["README.md", "AGENTS.md"]) {
  test(`every source path ${file} names exists`, () => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const named = [...text.matchAll(/`((?:src|test|docs|targets)\/[^`\s*<]*)`/g)].map((m) => m[1]);
    assert.ok(named.length > 5, `${file} names its files`);
    const missing = [...new Set(named)].filter((p) => !fs.existsSync(path.join(root, p)));
    assert.deepEqual(missing, [], `named in ${file}, not in the project`);
  });
}
