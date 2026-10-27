/** Moment 03 — Watch it write. Sections fill in place beneath the title:
 *  each carries its inquiry's live activity until prose streams in — the
 *  inquiry's own report is the section's draft. In an Investigation the
 *  sections open from their predecessors' findings; in a Survey they land
 *  in whatever order they settle. The settling pass at the end edits the
 *  brief into one voice. */
import type { CSSProperties, ReactElement } from "react";
import { color, font } from "../theme.js";
import { useProjection } from "@lloyal-labs/ui";
import {
  selectControls, selectRail, selectSections, selectSettling, selectTitle,
} from "../select.js";
import { Thinking, doc, spread } from "../parts/Shell.js";
import { Figures } from "../parts/Figures.js";
import { InquiryRow } from "../parts/InquiryRow.js";
import { OutlineRail } from "../parts/OutlineRail.js";
import { Prose, StreamingProse } from "../parts/Prose.js";
import { QuestionTitle } from "../parts/QuestionTitle.js";

export function Write(): ReactElement {
  const title = useProjection(selectTitle);
  const sections = useProjection(selectSections);
  const settling = useProjection(selectSettling);
  const rail = useProjection(selectRail);
  const { closing } = useProjection(selectControls);

  return (
    <div style={spread}>
    <div style={doc}>
      <QuestionTitle question={title} below={10} />
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
          {s.draft && <Prose markdown={s.draft} anchorPrefix={`s${s.index}d`} />}
          {s.draft && s.stopped && <Stop note={s.stopped.note} />}
          {s.prose && (s.streaming ? (
            <>
              <StreamingProse markdown={s.prose} anchorPrefix={`s${s.index}`} />
              <span className="fn-caret" />
            </>
          ) : (
            <Prose markdown={s.prose} anchorPrefix={`s${s.index}`} />
          ))}
          {!s.draft && s.stopped && <Stop note={s.stopped.note} />}
          {s.stopped?.tail && <p style={S.tail}>{s.stopped.tail}</p>}
        </section>
      ))}

      {settling && (
        <section style={S.section}>
          <h2 style={S.head}>
            Settling the brief<Thinking> one voice…</Thinking>
          </h2>
          {settling.body ? (
            <>
              <StreamingProse markdown={settling.body} />
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

/** Where a section's text stopped before its inquiry finished: a rule with the cause, so a stop reads as a
 *  stop. The text above it is what was kept; anything beneath it in the dim voice was written and not kept. */
function Stop({ note }: { note: string }): ReactElement {
  return (
    <div style={S.stop} role="note">
      <span style={S.stopLine} />
      <span style={S.stopNote}>{note}</span>
      <span style={S.stopLine} />
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  stop: { display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", color: color.dim, font: `12px ${font.ui}` },
  stopLine: { flex: 1, height: 1, background: color.line },
  stopNote: { flex: "none", fontStyle: "italic" },
  // What streamed and was not kept: plain text, never markdown, so a cut inside a table or a fence ends here.
  tail: { font: `400 14px/1.6 ${font.ui}`, color: color.dim, whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "0 0 14px" },
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
