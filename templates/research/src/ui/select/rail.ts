/** The outline beside the document: sections and the headings streaming into them while the brief writes,
 *  the settled answer's own headings once it has. */
import { type AppState } from "../state.js";
import { activeDoc, selectMoment } from "./canvas.js";
import { selectSections } from "./write.js";
import { selectCitations, selectSettleProse } from "./settle.js";

export interface OutlineEntry {
  anchor: string;
  text: string;
  /** 0 = a section (task); 1–2 = headings inside its prose. */
  level: 0 | 1 | 2;
  /** Owning section index, for identity color. */
  index: number;
}

const slugify = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "h";

/** Every markdown heading in document order, anchored under `prefix`.
 *  Pure and shared with `Prose`, which assigns these same ids in render
 *  order — the rail and the document cannot disagree. Repeated headings
 *  get numbered anchors so ids stay unique. Fences are skipped; inline
 *  markup is stripped from the shown text. */
export const anchorsOf = (
  markdown: string,
  prefix: string,
): { anchor: string; text: string; depth: number }[] => {
  const out: { anchor: string; text: string; depth: number }[] = [];
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
    const slug = slugify(text);
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    out.push({ anchor: `${prefix}-${slug}${n > 1 ? `-${n}` : ""}`, text, depth: m[1].length });
  }
  return out;
};

const railLevel = (depth: number): 1 | 2 => (depth <= 2 ? 1 : 2);

/** The rail: sections and the headings streaming into them while the brief
 *  writes; the settled answer's own headings once it lands. */
export const selectRail = (app: AppState): OutlineEntry[] => {
  const moment = selectMoment(app);
  if (moment === "write") {
    return selectSections(app).flatMap((s): OutlineEntry[] => [
      { anchor: `s${s.index}`, text: s.title, level: 0, index: s.index },
      ...(s.prose ? anchorsOf(s.prose, `s${s.index}`) : []).map((h): OutlineEntry => ({
        anchor: h.anchor, text: h.text, level: railLevel(h.depth), index: s.index,
      })),
    ]);
  }
  if (moment === "settle") {
    const body = selectSettleProse(app);
    if (!body) return [];
    const entries = anchorsOf(body, "a").map((h): OutlineEntry => ({
      anchor: h.anchor, text: h.text, level: railLevel(h.depth), index: 0,
    }));
    if (selectCitations(app).length > 0) {
      // The grid's own anchor lives outside the markdown `a-` namespace so a
      // report's "## Sources" heading can never collide with it.
      entries.push({ anchor: "grid-sources", text: "Sources", level: 1, index: 0 });
    }
    activeDoc(app).exchanges.forEach((x, i) => {
      // Each thread entry is its own document in the rail: the question heads
      // the group, and the answer's headings nest beneath it — an Extend's
      // full outline stands under its question, an Ask's short answer adds
      // nothing.
      entries.push({ anchor: `e${i}`, text: x.question, level: 0, index: i + 1 });
      anchorsOf(x.body, `e${i}`).forEach((h) => {
        entries.push({
          anchor: h.anchor, text: h.text, level: railLevel(h.depth), index: i + 1,
        });
      });
    });
    return entries;
  }
  return [];
};
