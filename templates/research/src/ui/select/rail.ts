/** The outline beside the document: sections and the headings streaming into them while the brief writes,
 *  the settled answer's own headings once it has. */
import { headingsOf, anchorsOf as anchored } from "@lloyal-labs/ui/prose";
import type { Anchor } from "@lloyal-labs/ui/prose";
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

/** The headings the brief gives an id to: the four levels its type scale sets (`Prose` styles `h1`–`h4`), as the
 *  renderer reads them, anchored under `prefix`. Shared with `Prose`, which assigns these same ids to its
 *  headings in render order — the rail and the document cannot disagree. */
export const anchorsOf = (markdown: string, prefix: string): Anchor[] =>
  anchored(headingsOf(markdown).filter((h) => h.depth <= 4), prefix);

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
