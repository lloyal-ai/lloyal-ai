/**
 * The library — settled briefs on disk. Everything that touches the library's
 * files lives here: enumeration for the sidebar, the realpath confinement
 * every client-supplied path must pass, and the read/remove operations the
 * command arms compose. The wire stays in harness.ts; the disk stays here.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { LibraryEntry } from "./state-core.js";

/** A client-supplied library path is trusted only once its REAL location
 *  (symlinks resolved) is a report.md EXACTLY one run-dir below the library
 *  root — realpath on both sides, so a planted link can't lead the read
 *  outside the output dir, and the depth rule keeps `removeReport`'s
 *  dirname-removal aimed at a run dir, never the root itself (a root-level
 *  report.md would otherwise make delete take the whole library) nor some
 *  deeper tree the corpus happens to hold. Missing paths land in the catch:
 *  null means "not a library report". */
export function confinedReport(outputDir: string, candidate: string): string | null {
  try {
    const root = fs.realpathSync(path.resolve(outputDir));
    const resolved = fs.realpathSync(path.resolve(candidate));
    return path.dirname(path.dirname(resolved)) === root &&
      path.basename(resolved) === "report.md"
      ? resolved
      : null;
  } catch {
    return null;
  }
}

/** One sidebar entry per run dir that actually settled — error runs leave no
 *  report.md. Title and byline come from the report's own first lines
 *  (`# query` / `> ISO · mode · …`, RunDirSink's format), newest first. */
export function listReports(outputDir: string): LibraryEntry[] {
  if (!fs.existsSync(outputDir)) return [];
  const entries: LibraryEntry[] = [];
  for (const name of fs.readdirSync(outputDir)) {
    // The same confinement every command applies — a symlinked run dir
    // must not surface an external file's title into the sidebar.
    const reportPath = confinedReport(outputDir, path.join(outputDir, name, "report.md"));
    if (reportPath === null) continue;
    let text: string;
    try {
      text = fs.readFileSync(reportPath, "utf8");
    } catch {
      continue;
    }
    const [titleLine = "", , metaLine = ""] = text.split("\n");
    const meta = /^> (\S+) · (flat|deep)/.exec(metaLine);
    entries.push({
      path: reportPath,
      docId: name,
      title: titleLine.replace(/^#\s*/, "") || name,
      savedAt: meta?.[1] ?? name,
      mode: meta?.[2] === "flat" || meta?.[2] === "deep" ? meta[2] : null,
      // The meta line records the roots a brief carried; the row only needs
      // the fact, so a glyph can mark media-bearing briefs without a read.
      hasMedia: /·\s*media\s+sha256:/.test(metaLine),
    });
  }
  return entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

/** Parse a CONFINED report file into its restore payload: the title from the
 *  `# query` line, the root manifest digests off the metadata line, and the
 *  body past the 3-line metadata header.
 *
 *  The report records ADDRESSES, never bytes — the content-addressed store
 *  still holds those, which is what makes a settled brief show the images it
 *  was given rather than only describe them. A report written before this
 *  carries no media segment and reads back as none. */
export function readReport(
  resolvedPath: string,
): { path: string; title: string; body: string; attachments: string[] } {
  const lines = fs.readFileSync(resolvedPath, "utf8").split("\n");
  const media = /·\s*media\s+((?:sha256:[0-9a-f]{64}\s*)+)/.exec(lines[2] ?? "");
  return {
    path: resolvedPath,
    title: (lines[0] ?? "").replace(/^#\s*/, "") || "Reopened report",
    body: lines.slice(3).join("\n").trim(),
    attachments: media ? (media[1] ?? "").trim().split(/\s+/) : [],
  };
}

/** A topic's whole thread: the report plus every exchange beside it, in
 *  order. `readReport` parses each file — same format, same reader. The
 *  result is STRUCTURAL — `body`/`attachments` are the root's own, each
 *  exchange keeps its question, body, and media — so the fold can put every
 *  figure beside the question that carried it. `thread` is the whole
 *  conversation as one text: what the trunk commit prefills, so the
 *  reopened KV still holds the full thread. */
export function readThread(
  reportPath: string,
): {
  path: string; title: string; body: string; attachments: string[];
  exchanges: { question: string; body: string; attachments: string[] }[];
  thread: string;
} {
  const root = readReport(reportPath);
  const dir = path.dirname(reportPath);
  // Each exchange passes the same test the report did: its REAL location is a
  // regular file directly inside the real run dir. A symlink named like an
  // exchange must not pull a file from elsewhere onto the wire.
  const realDir = fs.realpathSync(dir);
  const confined = (name: string): string | null => {
    try {
      const real = fs.realpathSync(path.join(dir, name));
      return path.dirname(real) === realDir && fs.statSync(real).isFile() ? real : null;
    } catch {
      return null;
    }
  };
  const exchanges = fs.readdirSync(dir)
    .map((name) => /^exchange-(\d+)\.md$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => confined(m[0]))
    .filter((p): p is string => p !== null)
    .map((p) => readReport(p));
  return {
    path: reportPath,
    title: root.title,
    body: root.body,
    attachments: root.attachments,
    exchanges: exchanges.map((e) => ({ question: e.title, body: e.body, attachments: e.attachments })),
    thread: [root.body, ...exchanges.map((e) => `---\n\n# ${e.title}\n\n${e.body}`)].join('\n\n'),
  };
}

/** Remove a CONFINED report's WHOLE run dir — report + annexures + thread. */
export function removeReport(resolvedPath: string): void {
  fs.rmSync(path.dirname(resolvedPath), { recursive: true, force: true });
}
