/**
 * The layered config carries every documented model key through the same
 * rungs. `model.llm.mmproj` is documented as the projector override; the
 * boot reads `config.model.mmproj`, so the loader must put it there —
 * from harness.yml, and from the local overlay above it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../../harness/config.js";

test("model.llm.mmproj reaches config.model.mmproj", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  const llm = { id: "qwen3.5-4b-q4", mmproj: "mmproj-qwen3.5-4b-f16" };
  const { config } = loadConfig({ model: { llm } }, {}, {}, cwd);
  assert.equal(config.model.mmproj, "mmproj-qwen3.5-4b-f16");
});

test("the local overlay's model.mmproj wins over harness.yml", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  fs.writeFileSync(path.join(cwd, "harness.json"),
    JSON.stringify({ version: 1, sources: {}, abilities: {}, defaults: {}, model: { mmproj: "local-projector" } }));
  const llm = { id: "qwen3.5-4b-q4", mmproj: "yml-projector" };
  const { config } = loadConfig({ model: { llm } }, {}, {}, cwd);
  assert.equal(config.model.mmproj, "local-projector");
});
