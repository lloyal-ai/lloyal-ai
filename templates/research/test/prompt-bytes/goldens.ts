/**
 * Goldens for the view's document derivations over the real briefs on disk: what the view's
 * `anchorsOf`, `selectCitations` and `shedTrailingSources` answer for each `report.md`, as JSON. A refactor that
 * derives the same facts from a markdown parser must reproduce these before the regexes are deleted.
 *
 * Run from the project root:
 *   node --import tsx test/prompt-bytes/goldens.ts <outDir> <report.md>...
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { anchorsOf } from "../../src/ui/select/rail.js";
import { selectCitations, shedTrailingSources } from "../../src/ui/select/settle.js";
import { reduce, initialState } from "../../src/ui/state.js";

const [outDir, ...reports] = process.argv.slice(2);
if (!outDir || reports.length === 0) throw new Error("usage: goldens.ts <outDir> <report.md>...");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, "briefs"), { recursive: true });

type Ev = Parameters<typeof reduce>[1];
/** The settled answer as the view holds it — `selectCitations` reads the active document's answer. */
const settled = (body: string) =>
  [{ type: "query", docId: "d1", query: "Q", warm: false }, { type: "answer", text: body }].reduce(
    (s, ev) => reduce(s, ev as Ev), initialState);

/** The body the library hands the view today: `readReport` drops a report's title line, the blank and the meta
 *  line; an annexure (the woven findings, ending in the weave's `Sources:` list) is read whole. */
const bodyOf = (file: string, md: string): string =>
  path.basename(file) === "report.md" ? md.split("\n").slice(3).join("\n") : md;

for (const report of reports) {
  const md = fs.readFileSync(report, "utf8");
  const body = bodyOf(report, md);
  const scaffold = path.basename(path.resolve(report, "..", "..", ".."));
  const folder = path.basename(path.dirname(report));
  const name = `${scaffold}--${folder}--${path.basename(report, ".md")}`;
  const golden = {
    source: report,
    anchors: anchorsOf(body, "a"),
    citations: selectCitations(settled(body)),
    shed: shedTrailingSources(body),
    shedRemoved: body.trimEnd().length - shedTrailingSources(body).length,
  };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(golden, null, 2) + "\n");
  fs.copyFileSync(report, path.join(outDir, "briefs", `${name}.md`));
  console.log(`${name}: ${golden.anchors.length} anchors, ${golden.citations.length} citations, trailer ${golden.shedRemoved} chars`);
}
