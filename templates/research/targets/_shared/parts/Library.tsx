/** Completed reports — every settled brief on disk, newest first. Clicking
 *  one opens it in place of the canvas; asking over it reframes fully
 *  (local, just not warm). The list is the run dirs themselves: whatever
 *  the corpus ability ingests for cross-report memory, the reader browses
 *  here — and the trash removes a brief's whole run dir and re-indexes,
 *  so the system unlearns it. Two taps: the first arms, the second (within
 *  a beat) deletes. */
import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
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
  const [arming, setArming] = useState<string | null>(null);

  useEffect(() => {
    if (arming === null) return;
    const t = setTimeout(() => setArming(null), 2500);
    return () => clearTimeout(t);
  }, [arming]);

  if (entries.length === 0) return null;

  const remove = (path: string): void => {
    send({ type: "library_delete", path });
    setArming(null);
    if (open === path) onOpen(null);
  };

  return (
    <nav style={S.wrap} aria-label="completed reports">
      <p style={S.kicker}>Completed reports</p>
      <div style={S.list}>
        {entries.map((e) => (
          <div
            key={e.path}
            role="button"
            tabIndex={0}
            style={{ ...S.entry, ...(open === e.path ? S.entryOn : null) }}
            onClick={() => {
              send({ type: "library_read", path: e.path });
              onOpen(e.path);
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                send({ type: "library_read", path: e.path });
                onOpen(e.path);
              }
            }}
          >
            <span style={S.entryBody}>
              <span style={S.entryTitle}>{e.title}</span>
              <span style={S.entryMeta}>{day(e.savedAt)}</span>
            </span>
            <button
              type="button"
              style={{ ...S.trash, ...(arming === e.path ? S.trashArmed : null) }}
              title="Delete this report — the corpus unlearns it"
              aria-label={arming === e.path ? "confirm delete" : "delete this report"}
              onClick={(ev) => {
                ev.stopPropagation();
                if (arming === e.path) remove(e.path);
                else setArming(e.path);
              }}
            >
              {arming === e.path ? (
                "Sure?"
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              )}
            </button>
          </div>
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
    color: color.dim, margin: "0 6px 7px",
  },
  list: { display: "flex", flexDirection: "column", gap: 1, overflowY: "auto", minHeight: 0 },
  entry: {
    display: "flex", alignItems: "center", gap: 6,
    font: `12px/1.4 ${font.ui}`, color: color.dim,
    borderRadius: radius.control, padding: "6px 6px", cursor: "pointer", flex: "none",
  },
  entryOn: { background: color.card, color: color.ink },
  entryBody: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 },
  entryTitle: {
    overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical", fontWeight: 500,
  },
  entryMeta: { font: `10.5px ${font.ui}`, color: color.dim },
  trash: {
    font: `600 10px ${font.ui}`, color: color.dim, background: "none", border: 0,
    borderRadius: 6, width: 22, height: 22, padding: 0, display: "grid",
    placeItems: "center", cursor: "pointer", flex: "none",
  },
  trashArmed: { color: color.danger, background: "#F7E2DF", width: "auto", padding: "0 6px" },
  back: {
    font: `600 11.5px ${font.ui}`, color: color.dim, background: "none", border: 0,
    textAlign: "left", padding: "8px 6px 0", cursor: "pointer", flex: "none",
  },
};
