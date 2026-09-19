/** Media leaves its codecs to the harness: `@embedpdf/pdfium` reads a PDF, `sharp` normalises an image, and both
 *  are OPTIONAL peers, so nothing installs them but this project's own manifest. A scaffold that forgets one
 *  fails at the first attachment, in a browser, with no test to say so — except this one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const manifest = (p: string): { dependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }> } =>
  JSON.parse(fs.readFileSync(p, "utf8"));

test("every optional peer media names is a dependency of this project", () => {
  const media = manifest(path.join(root, "node_modules", "@lloyal-labs", "media", "package.json"));
  const optional = Object.entries(media.peerDependenciesMeta ?? {}).filter(([, m]) => m.optional).map(([name]) => name);
  assert.ok(optional.length >= 2, "media names its codecs as optional peers");
  const declared = Object.keys(manifest(path.join(root, "package.json")).dependencies ?? {});
  assert.deepEqual(optional.filter((p) => !declared.includes(p)), [], "a codec media relies on, and a fresh scaffold would not install");
});
