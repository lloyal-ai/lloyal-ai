/** The brief's floating outline: every section and the headings streaming
 *  into it, in reading order. Click to jump. Sticky beside the document,
 *  outside its measure — it never widens the prose. */
import type { CSSProperties, ReactElement } from "react";
import { color, font, inquiryColor } from "../theme.js";
import type { OutlineEntry } from "../select.js";

export function OutlineRail({ entries }: { entries: OutlineEntry[] }): ReactElement | null {
  if (entries.length < 2) return null;
  return (
    <nav style={S.rail} aria-label="brief outline">
      {entries.map((e, i) => (
        <button
          key={`${e.anchor}-${i}`}
          type="button"
          style={{
            ...S.entry,
            ...LEVEL_STYLE[e.level],
            ...(e.level === 0 ? { color: inquiryColor(e.index) } : null),
          }}
          onClick={() =>
            document.getElementById(e.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        >
          {e.text}
        </button>
      ))}
    </nav>
  );
}

const LEVEL_STYLE: Record<OutlineEntry["level"], CSSProperties> = {
  0: { fontWeight: 700, marginTop: 10 },
  1: { paddingLeft: 14 },
  2: { paddingLeft: 26, color: color.faint },
};

const S: Record<string, CSSProperties> = {
  rail: {
    position: "sticky", top: 4, alignSelf: "flex-start", width: 212, flex: "none",
    maxHeight: "calc(100dvh - 230px)", overflowY: "auto",
    padding: "0 14px 12px 0", display: "flex", flexDirection: "column", gap: 1,
  },
  entry: {
    font: `12px/1.45 ${font.ui}`, color: color.dim, background: "none", border: 0,
    textAlign: "left", cursor: "pointer", padding: "2px 7px", borderRadius: 6,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%",
    flex: "none",
  },
};
