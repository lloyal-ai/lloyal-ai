/** Moment 04 — Settle. The document takes the room: byline, the brief's
 *  prose with its woven citations, and the deliberation behind it on
 *  request. (Citation chips, sources grid, and margin marks arrive with
 *  the settle build-out.) */
import { useState, type CSSProperties, type ReactElement } from "react";
import { color, font } from "../theme.js";
import { useBrief } from "../store.js";
import { selectAnswer, selectRail, selectShape, selectTitle, SHAPES } from "../select.js";
import { doc } from "../parts/Shell.js";
import { OutlineRail } from "../parts/OutlineRail.js";
import { Prose } from "../parts/Prose.js";

export function Settle(): ReactElement {
  const title = useBrief(selectTitle);
  const answer = useBrief(selectAnswer);
  const shape = useBrief(selectShape);
  const rail = useBrief(selectRail);
  const [showThinking, setShowThinking] = useState(false);
  const shapeTitle = SHAPES.find((s) => s.shape === shape)?.title;

  return (
    <div style={S.spread}>
    <div style={doc}>
      <h1 style={S.title}>{title}</h1>
      <p style={S.byline}>
        <span>{new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
        {shapeTitle && <span>{shapeTitle}</span>}
      </p>
      {answer?.thinking && (
        <button type="button" style={S.thinkToggle} onClick={() => setShowThinking((v) => !v)}>
          {showThinking ? "Hide the deliberation" : "How it got here"}
        </button>
      )}
      {showThinking && answer?.thinking && <p style={S.thinking}>{answer.thinking}</p>}
      {answer?.body && <Prose markdown={answer.body} anchorPrefix="a" />}
    </div>
    <OutlineRail entries={rail} />
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  spread: { display: "flex", alignItems: "flex-start" },
  title: { font: `600 31px/1.22 ${font.ui}`, letterSpacing: "-.022em", margin: "0 0 6px", textWrap: "balance" },
  byline: { font: `12.5px ${font.ui}`, color: color.faint, margin: "0 0 22px", display: "flex", gap: 14 },
  thinkToggle: {
    font: `600 12px ${font.ui}`, color: color.dim, background: "none", border: 0,
    padding: 0, cursor: "pointer", marginBottom: 10,
  },
  thinking: {
    font: `12.5px/1.6 ${font.ui}`, color: color.faint, whiteSpace: "pre-wrap",
    borderLeft: `2px solid ${color.line}`, padding: "2px 0 2px 12px", margin: "0 0 18px",
  },
};
