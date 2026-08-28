/** Completed reports — every settled brief on disk, newest first. Clicking
 *  one opens it in place of the canvas; asking over it reframes fully
 *  (local, just not warm). The list is the run dirs themselves: whatever
 *  the corpus ability ingests for cross-report memory, the reader browses
 *  here. */
import type { CSSProperties, ReactElement } from "react";
import { color, font, radius } from "../theme.js";
import { send, useBrief } from "../store.js";
import { selectLibrary } from "../select.js";

const day = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export function Library({ open, onOpen }: {
  open: string | null;
  onOpen: (path: string | null) => void;
}): ReactElement | null {
  const entries = useBrief(selectLibrary);
  if (entries.length === 0) return null;
  return (
    <nav style={S.wrap} aria-label="completed reports">
      <p style={S.kicker}>Completed reports</p>
      <div style={S.list}>
        {entries.map((e) => (
          <button
            key={e.path}
            type="button"
            style={{ ...S.entry, ...(open === e.path ? S.entryOn : null) }}
            onClick={() => {
              send({ type: "library_read", path: e.path });
              onOpen(e.path);
            }}
          >
            <span style={S.entryTitle}>{e.title}</span>
            <span style={S.entryMeta}>{day(e.savedAt)}</span>
          </button>
        ))}
      </div>
      {open !== null && (
        <button type="button" style={S.back} onClick={() => onOpen(null)}>
          ← Back
        </button>
      )}
    </nav>
  );
}

const S: Record<string, CSSProperties> = {
  wrap: {
    margin: "20px 0 0", display: "flex", flexDirection: "column", minHeight: 0,
  },
  kicker: {
    font: `600 10px ${font.ui}`, letterSpacing: ".14em", textTransform: "uppercase",
    color: color.faint, margin: "0 6px 7px",
  },
  list: { display: "flex", flexDirection: "column", gap: 1, overflowY: "auto", minHeight: 0 },
  entry: {
    display: "flex", flexDirection: "column", gap: 2, textAlign: "left",
    font: `12px/1.4 ${font.ui}`, color: color.dim, background: "none", border: 0,
    borderRadius: radius.control, padding: "6px 6px", cursor: "pointer", flex: "none",
  },
  entryOn: { background: color.card, color: color.ink },
  entryTitle: {
    overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical", fontWeight: 500,
  },
  entryMeta: { font: `10.5px ${font.ui}`, color: color.faint },
  back: {
    font: `600 11.5px ${font.ui}`, color: color.dim, background: "none", border: 0,
    textAlign: "left", padding: "8px 6px 0", cursor: "pointer", flex: "none",
  },
};
