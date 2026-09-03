/** Completed reports — every settled brief on disk, newest first. Clicking
 *  one RESTORES it as the session document (the canvas, Ask, and Extend
 *  behave exactly as over a fresh settle; the report prefills the trunk on
 *  the first question). The list is the run dirs themselves: whatever the
 *  corpus ability ingests for cross-report memory, the reader browses here
 *  — and the trash removes a brief's whole run dir and re-indexes, so the
 *  system unlearns it. Two taps: the first arms, the second (within a
 *  beat) deletes. */
import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { color, font, radius } from "../theme.js";
import { send, useBrief } from "../store.js";
import {
  selectLibrary, selectLibrarySearch, selectLive, selectTitle, type ReportEntry,
} from "../select.js";

/** Order entries by a best-first path ranking; anything the ranking does not
 *  name keeps its place at the tail. The HOST ranks — the view only follows,
 *  so relevance has exactly one author. */
const rankBy = (entries: ReportEntry[], ranked: string[]): ReportEntry[] => {
  const rank = new Map(ranked.map((p, i) => [p, i]));
  return [...entries].sort(
    (a, b) => (rank.get(a.path) ?? Infinity) - (rank.get(b.path) ?? Infinity),
  );
};

const day = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export function Library(): ReactElement | null {
  const entries = useBrief(selectLibrary);
  const title = useBrief(selectTitle);
  const search = useBrief(selectLibrarySearch);
  const live = useBrief(selectLive);
  const [arming, setArming] = useState<string | null>(null);
  const [q, setQ] = useState("");
  /** A scoring call is in flight — set when the debounce fires, cleared when
   *  the ranking lands. The list dims and the field carries a working lamp,
   *  so a pause-then-nothing never reads as a dead search. */
  const [awaiting, setAwaiting] = useState(false);

  // A pause, not a keystroke, is the query: the reranker reads the whole
  // library per call, so the wire carries settled intent only. An emptied
  // field settles too, and clears the search host-side.
  useEffect(() => {
    const t = setTimeout(() => {
      send({ type: "library_search", query: q });
      setAwaiting(q.trim() !== "" && !live);
    }, 250);
    return () => clearTimeout(t);
  }, [q, live]);
  useEffect(() => {
    setAwaiting(false);
  }, [search]);

  useEffect(() => {
    if (arming === null) return;
    const t = setTimeout(() => setArming(null), 2500);
    return () => clearTimeout(t);
  }, [arming]);

  if (entries.length === 0) return null;

  const remove = (path: string): void => {
    send({ type: "library_delete", path });
    setArming(null);
  };

  // While a search is live the order is relevance, not time — the day
  // grouping rests until the field clears.
  const rows = search ? rankBy(entries, search.ranked) : entries;

  // One divider per day instead of a date under every row — the list is
  // newest-first, so a label marks each change of day on the way down.
  let lastDay = "";

  return (
    <nav style={S.wrap} aria-label="library of settled briefs">
      <style>{HOVER}</style>
      <p style={S.kicker}>Library · {entries.length}</p>
      <span style={S.searchWrap}>
      <input
        className="lib-search"
        style={S.search}
        value={q}
        disabled={live}
        placeholder={live ? "Search rests while a brief writes" : "Search the library…"}
        aria-label="Search the library"
        onChange={(ev) => setQ(ev.target.value)}
      />
      {awaiting && <span className="fn-lamp" style={S.searchDot} />}
      </span>
      <div className="lib-list" style={{ ...S.list, ...(awaiting ? S.listWaiting : null) }}>
        {rows.map((e) => {
          const d = day(e.savedAt);
          const divider = search === null && d !== lastDay ? d : null;
          lastDay = d;
          return (
          <div key={e.path} style={S.group}>
            {divider && <p style={S.day}>{divider}</p>}
            <div
              className="lib-row"
              role="button"
              tabIndex={0}
              title={e.title}
              style={{ ...S.entry, ...(title && e.title === title ? S.entryOn : null) }}
              onClick={() => send({ type: "open_doc", docId: e.docId })}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") send({ type: "open_doc", docId: e.docId });
              }}
            >
            <span style={S.entryBody}>
              <span style={S.entryTitle}>{e.title}</span>
            </span>
            {e.hasMedia && (
              <svg style={S.media} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="carries images">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="9" cy="9" r="1.6" />
                <path d="M21 15l-4.5-4.5L6 21" />
              </svg>
            )}
            <button
              type="button"
              className="lib-trash"
              data-armed={arming === e.path || undefined}
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
          </div>
          );
        })}
      </div>
    </nav>
  );
}

/** Hover states inline styles cannot express. The trash exists on every row
 *  but shows only where the pointer (or focus) is — fourteen always-on
 *  deletion icons read as a queue, not a library. Armed, it stays put. */
const HOVER = `
  .lib-row:hover { background: ${color.card2}; }
  .lib-row .lib-trash { opacity: 0; transition: opacity .12s ease; }
  .lib-row:hover .lib-trash, .lib-row:focus-within .lib-trash,
  .lib-trash[data-armed="true"] { opacity: 1; }
  .lib-list::-webkit-scrollbar { display: none; }
  .lib-search:disabled { opacity: .55; }
  .lib-search::placeholder { color: ${color.dim}; }
`;

const S: Record<string, CSSProperties> = {
  wrap: {
    margin: "20px 0 0", display: "flex", flexDirection: "column", minHeight: 0,
  },
  kicker: {
    font: `600 9.5px ${font.ui}`, letterSpacing: ".1em", textTransform: "uppercase",
    color: color.dim, margin: "0 6px 7px",
  },
  list: {
    display: "flex", flexDirection: "column", gap: 1, overflowY: "auto", minHeight: 0,
    // The list fades at its edges instead of clipping — paper, not a viewport.
    maskImage: "linear-gradient(to bottom, transparent 0, black 10px, black calc(100% - 14px), transparent 100%)",
    WebkitMaskImage: "linear-gradient(to bottom, transparent 0, black 10px, black calc(100% - 14px), transparent 100%)",
    padding: "8px 0 12px", scrollbarWidth: "none", transition: "opacity .15s ease",
  },
  searchWrap: { position: "relative", display: "flex", flexDirection: "column", flex: "none" },
  searchDot: {
    position: "absolute", right: 12, top: 10, width: 7, height: 7,
    borderRadius: "50%", background: color.ember,
  },
  listWaiting: { opacity: 0.65 },
  search: {
    font: `12px ${font.ui}`, color: color.ink, background: color.card2,
    border: `1px solid ${color.line}`, borderRadius: radius.control,
    padding: "5px 8px", margin: "0 4px 4px", outline: 0,
  },
  group: { display: "flex", flexDirection: "column", flex: "none" },
  /** The one date per day, standing where fourteen row-dates used to sit. */
  day: { font: `600 10px ${font.ui}`, color: color.dim, margin: "6px 6px 3px" },
  entry: {
    display: "flex", alignItems: "center", gap: 6,
    font: `12px/1.4 ${font.ui}`, color: color.dim,
    borderRadius: radius.control, padding: "6px 6px", cursor: "pointer", flex: "none",
  },
  entryOn: { background: color.card, color: color.ink },
  entryBody: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 },
  // One line each — the full question rides the tooltip, and halving the rows
  // doubles how much library is visible before a scroll.
  entryTitle: {
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500,
  },
  media: { color: color.dim, flex: "none" },
  trash: {
    font: `600 10px ${font.ui}`, color: color.dim, background: "none", border: 0,
    borderRadius: 6, width: 22, height: 22, padding: 0, display: "grid",
    placeItems: "center", cursor: "pointer", flex: "none",
  },
  trashArmed: { color: color.danger, background: "#F7E2DF", width: "auto", padding: "0 6px" },
};
