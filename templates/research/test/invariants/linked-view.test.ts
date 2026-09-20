/** Under `lloyal link-local` the platform is symlinked in, Vite does not pre-bundle a linked package, and a
 *  CommonJS entry served raw has no named exports: the page is blank, with one line in the console. The web
 *  config's `optimizeDeps.include` must therefore name every platform entry the page can reach — and the page
 *  reaches one whenever ANY file it loads imports a value from it, however far from the view that file sits
 *  (`src/config.ts` is reached through `App.tsx`). So the reach is walked, not listed: from the page's entry,
 *  along every relative import that carries a value. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

/** Imports and re-exports that carry a value — a type-only one is erased and reaches nothing. */
const valueImports = (source: string): string[] =>
  [...source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm), ...source.matchAll(/^import\s+["']([^"']+)["']/gm)]
    .map((m) => m[1]);

/** A relative specifier as the file it names (`./x.js` is `./x.ts` or `./x.tsx` on disk). */
const fileOf = (from: string, spec: string): string | null => {
  const base = path.resolve(path.dirname(from), spec.replace(/\.js$/, ""));
  return [".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find((f) => fs.existsSync(f)) ?? null;
};

/** Every platform entry a page loads a value from, walking relative imports from its entry. */
const reachedFrom = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const reached = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of valueImports(fs.readFileSync(file, "utf8"))) {
      if (spec.startsWith("@lloyal-labs/")) reached.add(spec);
      else if (spec.startsWith(".")) { const next = fileOf(file, spec); if (next) visit(next); }
    }
  };
  visit(path.join(root, entry));
  return reached;
};

test("the web config pre-bundles every platform entry the page loads a value from", () => {
  const reached = reachedFrom("targets/web/main.tsx");
  assert.ok(reached.has("@lloyal-labs/ui"), `the walk reaches the view: ${[...reached].join(", ")}`);
  const config = fs.readFileSync(path.join(root, "targets/web/vite.web.config.ts"), "utf8");
  const list = /include:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "";
  const included = new Set([...list.matchAll(/["'](@lloyal-labs\/[^"']+)["']/g)].map((m) => m[1]));
  const missing = [...reached].filter((e) => !included.has(e)).sort();
  assert.deepEqual(missing, [], "reached by the page, served raw under a link: a blank page");
});
