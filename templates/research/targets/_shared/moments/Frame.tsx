/** Moment 02 — Frame. The question rises into the title; the outline drafts
 *  itself beneath it. A clarify lands as the editor's query, in the
 *  document's voice. (Live outline drafting and plan editing arrive with
 *  the frame build-out; this renders the settled plan and the beats.) */
import type { CSSProperties, ReactElement } from "react";
import { color, font, inquiryColor } from "../theme.js";
import { useBrief } from "../store.js";
import { selectClarify, selectTitle } from "../select.js";
import { Thinking } from "../parts/Shell.js";
import { doc } from "../parts/Shell.js";

export function Frame(): ReactElement {
  const title = useBrief(selectTitle);
  const clarify = useBrief(selectClarify);
  const discovering = useBrief((app) => app.uiPhase === "discovering");
  const outline = useBrief((app) => app.plan?.tasks ?? []);

  return (
    <div style={doc}>
      <h1 style={S.title}>{title}</h1>

      {discovering && (
        <p style={S.beat}><Thinking>checking your libraries…</Thinking></p>
      )}
      {!discovering && outline.length === 0 && clarify.length === 0 && (
        <p style={S.beat}><Thinking>drafting the outline…</Thinking></p>
      )}

      {outline.length > 0 && (
        <div style={S.outline}>
          {outline.map((task, i) => (
            <div key={i} style={S.line}>
              <span style={{ ...S.lineN, color: inquiryColor(i) }}>{i + 1}</span>
              <span>{task.description}</span>
            </div>
          ))}
        </div>
      )}

      {clarify.length > 0 && (
        <div style={S.query}>
          <small style={S.queryKicker}>Before I frame this</small>
          {clarify.map((q, i) => (
            <p key={i} style={S.queryLine}>{q}</p>
          ))}
        </div>
      )}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  title: { font: `600 31px/1.22 ${font.ui}`, letterSpacing: "-.022em", margin: "0 0 18px", textWrap: "balance" },
  beat: { font: `14px ${font.ui}`, margin: "0 0 20px" },
  outline: { display: "flex", flexDirection: "column", gap: 2 },
  line: {
    display: "flex", gap: 13, alignItems: "baseline", padding: "10px 13px",
    borderRadius: 10, fontSize: 14.5, lineHeight: 1.5,
  },
  lineN: { font: `500 12px ${font.mono}`, flex: "none", width: 15 },
  query: {
    background: color.card, border: `1px solid ${color.line}`, borderLeft: `3px solid ${color.ember}`,
    borderRadius: "0 11px 11px 0", padding: "13px 17px", margin: "18px 0 0",
    font: `italic 400 15.5px/1.55 ${font.serif}`,
  },
  queryKicker: {
    display: "block", font: `600 10px ${font.ui}`, fontStyle: "normal",
    letterSpacing: ".15em", textTransform: "uppercase", color: color.emberDeep, marginBottom: 5,
  },
  queryLine: { margin: "0 0 4px" },
};
