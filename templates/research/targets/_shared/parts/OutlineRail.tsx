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
          style={{ ...S.entry, ...LEVEL_STYLE[e.level] }}
          onClick={() =>
            // Instant on purpose: smooth scrolling (JS or CSS) silently
            // no-ops in Chromium's nested scroller here — landing beats motion.
            document.getElementById(e.anchor)?.scrollIntoView({ behavior: "instant", block: "start" })
          }
        >
          <span
            style={{
              ...S.dot,
              ...(e.level === 0 ? { background: inquiryColor(e.index) } : null),
            }}
          />
          <span style={S.label}>{e.text}</span>
        </button>
      ))}
    </nav>
  );
}

const LEVEL_STYLE: Record<OutlineEntry["level"], CSSProperties> = {
  0: { fontWeight: 700, marginTop: 10, color: color.ink },
  1: { paddingLeft: 14 },
  2: { paddingLeft: 26, color: color.dim },
};

const S: Record<string, CSSProperties> = {
  rail: {
    // 52 clears the frosted runbar (48 + a breath) instead of sliding under it.
    position: "sticky", top: 52, alignSelf: "flex-start", width: 212, flex: "none",
    maxHeight: "calc(100dvh - 230px)", overflowY: "auto",
    padding: "0 14px 12px 0", display: "flex", flexDirection: "column", gap: 1,
  },
  entry: {
    font: `12px/1.45 ${font.ui}`, color: color.dim, background: "none", border: 0,
    textAlign: "left", cursor: "pointer", padding: "2px 7px", borderRadius: 6,
    maxWidth: "100%", flex: "none",
    display: "flex", alignItems: "center", gap: 7,
  },
  /** The inquiry's identity, carried by a mark rather than by colouring the
   *  words — the heading stays legible ink and the rail still reads as a
   *  column of headings, not a legend. Rendered at EVERY level so the gutter
   *  is reserved: filled only for a section, but always occupying its width,
   *  which keeps each level's indent measured from one origin. */
  dot: { width: 6, height: 6, borderRadius: "50%", flex: "none" },
  label: {
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
  },
};
