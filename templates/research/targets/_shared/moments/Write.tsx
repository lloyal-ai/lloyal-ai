/** Moment 03 — Watch it write. Sections fill in place beneath the title:
 *  each carries its inquiry's live activity until prose streams in — the
 *  inquiry's own report is the section's draft. In an Investigation the
 *  sections open from their predecessors' findings; in a Survey they land
 *  in whatever order they settle. The settling pass at the end edits the
 *  brief into one voice. */
import type { CSSProperties, ReactElement } from "react";
import { color, font } from "../theme.js";
import { useBrief } from "../store.js";
import {
  selectControls, selectRail, selectSections, selectSettling, selectTitle,
} from "../select.js";
import { Thinking, doc } from "../parts/Shell.js";
import { Figures } from "../parts/Figures.js";
import { InquiryRow } from "../parts/InquiryRow.js";
import { OutlineRail } from "../parts/OutlineRail.js";
import { Prose } from "../parts/Prose.js";

export function Write(): ReactElement {
  const title = useBrief(selectTitle);
  const sections = useBrief(selectSections);
  const settling = useBrief(selectSettling);
  const rail = useBrief(selectRail);
  const { closing } = useBrief(selectControls);

  return (
    <div style={S.spread}>
    <div style={doc}>
      <h1 style={S.title}>{title}</h1>
      <Figures />

      {sections.map((s) => (
        <section key={s.index} style={S.section}>
          <h2 id={`s${s.index}`} style={{ ...S.head, ...(s.inquiry ? null : S.headPending) }}>
            {s.title}
            {s.waiting && (
              <span style={S.queued} title="Queued — starts when an inquiry settles">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15.5 14" />
                </svg>
              </span>
            )}
            {s.streaming && <Thinking> writing…</Thinking>}
          </h2>
          {s.inherits && s.inquiry && s.inquiry.endedAt === null && !s.prose && (
            <p style={S.inherits}>opens from §{s.index}'s settled findings</p>
          )}
          {s.inquiry && s.inquiry.verb.kind !== "settled" && (
            <InquiryRow inquiry={s.inquiry} closing={closing} />
          )}
          {s.prose && (
            <>
              <Prose markdown={s.prose} anchorPrefix={`s${s.index}`} />
              {s.streaming && <span className="fn-caret" />}
            </>
          )}
        </section>
      ))}

      {settling && (
        <section style={S.section}>
          <h2 style={S.head}>
            Settling the brief<Thinking> one voice…</Thinking>
          </h2>
          {settling.body ? (
            <>
              <Prose markdown={settling.body} />
              <span className="fn-caret" />
            </>
          ) : (
            <p style={S.deliberating}>{settling.thinking?.slice(-240)}</p>
          )}
        </section>
      )}
    </div>
    <OutlineRail entries={rail} />
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  spread: { display: "flex", alignItems: "flex-start" },
  title: { font: `600 31px/1.22 ${font.ui}`, letterSpacing: "-.022em", margin: "0 0 10px", textWrap: "balance" },
  section: { margin: "0 0 26px" },
  head: { font: `600 17px/1.35 ${font.ui}`, letterSpacing: "-.012em", margin: "22px 0 10px", textWrap: "balance" },
  headPending: { color: color.dim },
  queued: { marginLeft: 8, color: color.dim, display: "inline-flex", verticalAlign: "baseline" },
  inherits: { font: `12.5px ${font.ui}`, color: color.dim, margin: "0 0 8px" },
  deliberating: {
    font: `12.5px/1.6 ${font.ui}`, color: color.dim, whiteSpace: "pre-wrap",
    borderLeft: `2px solid ${color.line}`, padding: "2px 0 2px 12px", margin: 0,
  },
};
