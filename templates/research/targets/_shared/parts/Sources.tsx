/** The sources grid: one card per cited source, numbered to match its
 *  chips, with what the run itself read about it. Ordinal tiles, no
 *  favicon fetching — the local-first promise reaches the images too. */
import type { CSSProperties, ReactElement } from "react";
import { color, font, radius, shadow } from "../theme.js";
import type { Citation } from "../select.js";

export function Sources({ citations, notes }: {
  citations: Citation[];
  notes: Map<string, string>;
}): ReactElement | null {
  if (citations.length === 0) return null;
  return (
    <section style={S.wrap}>
      <h2 id="grid-sources" style={S.head}>
        Sources<span style={S.count}>{citations.length}</span>
      </h2>
      <div style={S.grid}>
        {citations.map((c) => {
          const external = /^https?:\/\//.test(c.url);
          const body = (
            <>
              <span style={S.tile}>{c.ordinal}</span>
              <span style={S.body}>
                <span style={S.title}>{c.title}</span>
                <span style={S.meta}>
                  {c.host}
                  {c.cited > 1 && ` · cited ×${c.cited}`}
                </span>
                {notes.get(c.url) && <span style={S.note}>{notes.get(c.url)}</span>}
              </span>
            </>
          );
          // A corpus citation names a local file — a card, not a hyperlink.
          return external ? (
            <a key={c.url} href={c.url} target="_blank" rel="noreferrer" style={S.card}>
              {body}
            </a>
          ) : (
            <span key={c.url} style={S.card}>{body}</span>
          );
        })}
      </div>
    </section>
  );
}

const S: Record<string, CSSProperties> = {
  wrap: { margin: "30px 0 0" },
  head: {
    font: `600 17px/1.3 ${font.ui}`, letterSpacing: "-.012em", margin: "0 0 12px",
    display: "flex", alignItems: "baseline", gap: 8,
  },
  count: { font: `600 11.5px ${font.mono}`, color: color.dim },
  grid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10,
  },
  card: {
    display: "flex", gap: 10, alignItems: "flex-start", textDecoration: "none",
    background: color.card, border: `1px solid ${color.line}`, borderRadius: radius.card,
    boxShadow: shadow.card, padding: "11px 12px", color: color.ink, minWidth: 0,
  },
  tile: {
    width: 24, height: 24, borderRadius: 7, flex: "none", display: "grid", placeItems: "center",
    background: color.emberWash, color: color.emberDeep, font: `700 11.5px ${font.ui}`,
  },
  body: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
  title: {
    font: `600 12.5px/1.35 ${font.ui}`, overflow: "hidden", display: "-webkit-box",
    WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
  },
  meta: { font: `11px ${font.ui}`, color: color.dim },
  note: {
    font: `11.5px/1.5 ${font.ui}`, color: color.dim, overflow: "hidden",
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
  },
};
