/** A settled brief reopened from the library: the saved report rendered as
 *  the document it is, outline and all. Asking over it reframes fully —
 *  the report is local, just not warm. */
import type { CSSProperties, ReactElement } from "react";
import { color, font } from "../theme.js";
import {
  SHAPES, anchorsOf, parseReport, type OutlineEntry,
} from "../select.js";
import { doc } from "../parts/Shell.js";
import { OutlineRail } from "../parts/OutlineRail.js";
import { Prose } from "../parts/Prose.js";

export function Reopen({ body }: { body: string }): ReactElement {
  const { title, savedAt, mode, prose } = parseReport(body);
  const shapeTitle = SHAPES.find((s) => s.mode === mode)?.title;
  const rail = anchorsOf(prose, "r").map((h): OutlineEntry => ({
    anchor: h.anchor,
    text: h.text,
    level: h.depth <= 2 ? 1 : 2,
    index: 0,
  }));
  return (
    <div style={S.spread}>
    <div style={doc}>
      <h1 style={S.title}>{title}</h1>
      <p style={S.byline}>
        {savedAt && (
          <span>
            {new Date(savedAt).toLocaleDateString(undefined, {
              day: "numeric", month: "short", year: "numeric",
            })}
          </span>
        )}
        {shapeTitle && <span>{shapeTitle}</span>}
        <span>reopened — local, just not warm</span>
      </p>
      <Prose markdown={prose} anchorPrefix="r" />
    </div>
    <OutlineRail entries={rail} />
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  spread: { display: "flex", alignItems: "flex-start" },
  title: { font: `600 31px/1.22 ${font.ui}`, letterSpacing: "-.022em", margin: "0 0 6px", textWrap: "balance" },
  byline: {
    font: `12.5px ${font.ui}`, color: color.dim, margin: "0 0 22px",
    display: "flex", gap: 14,
  },
};
