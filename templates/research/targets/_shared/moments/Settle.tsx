/** Moment 04 — Settle. The document takes the room: byline, structural
 *  margin marks (facts of the run, never judgments of the content), the
 *  brief's prose with its citation chips, the sources grid the chips
 *  resolve into, and the deliberation behind it on request. Copy and
 *  Download hand over the same markdown the run dir keeps. */
import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { color, font, radius } from "../theme.js";
import { useBrief } from "../store.js";
import {
  DEPTHS, SHAPES, selectAnswer, selectAsk, selectCitations, selectDepth,
  selectExchanges, selectMarks, selectRail, selectRunShape, selectSettleProse,
  selectSourceNotes, selectTitle,
} from "../select.js";
import { Thinking, doc } from "../parts/Shell.js";
import { InquiryRow } from "../parts/InquiryRow.js";
import { OutlineRail } from "../parts/OutlineRail.js";
import { Prose } from "../parts/Prose.js";
import { Sources } from "../parts/Sources.js";

export function Settle(): ReactElement {
  const title = useBrief(selectTitle);
  const answer = useBrief(selectAnswer);
  const prose = useBrief(selectSettleProse);
  const citations = useBrief(selectCitations);
  const notes = useBrief(selectSourceNotes);
  const marks = useBrief(selectMarks);
  const shape = useBrief(selectRunShape);
  const depth = useBrief(selectDepth);
  const rail = useBrief(selectRail);
  const exchanges = useBrief(selectExchanges);
  const ask = useBrief(selectAsk);
  const [showThinking, setShowThinking] = useState(false);
  const [copied, setCopied] = useState(false);

  const ordinals = useMemo(
    () => new Map(citations.map((c) => [c.url, c.ordinal])),
    [citations],
  );
  const shapeTitle = SHAPES.find((s) => s.shape === shape)?.title;
  const depthTitle = DEPTHS.find((d) => d.depth === depth)?.title;

  // A served page on plain http has no `navigator.clipboard` — the hidden
  // textarea is the fallback that works everywhere the brief renders.
  const copy = (): void => {
    const text = answer?.body ?? "";
    const flash = (): void => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    const legacy = (): boolean => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(flash, () => { if (legacy()) flash(); });
    } else if (legacy()) {
      flash();
    }
  };

  const download = (): void => {
    const blob = new Blob([answer?.body ?? ""], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "brief"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={S.spread}>
    <div style={doc}>
      <h1 style={S.title}>{title}</h1>
      <p style={S.byline}>
        <span>{new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
        {shapeTitle && <span>{shapeTitle}</span>}
        {depthTitle && <span>{depthTitle}</span>}
        {citations.length > 0 && <span>{citations.length} sources</span>}
        <span style={{ flex: 1 }} />
        <button type="button" style={S.action} onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" style={S.action} onClick={download}>Download</button>
      </p>
      {marks.length > 0 && (
        <div style={S.marks}>
          {marks.map((m) => <p key={m} style={S.mark}>{m}</p>)}
        </div>
      )}
      {answer?.thinking && (
        <button type="button" style={S.thinkToggle} onClick={() => setShowThinking((v) => !v)}>
          {showThinking ? "Hide the deliberation" : "How it got here"}
        </button>
      )}
      {showThinking && answer?.thinking && <p style={S.thinking}>{answer.thinking}</p>}
      {prose && <Prose markdown={prose} anchorPrefix="a" citations={ordinals} />}
      <Sources citations={citations} notes={notes} />
      {exchanges.map((x, i) => (
        <section key={i} style={S.exchange}>
          <h2 id={`e${i}`} style={S.exchangeHead}>{x.question}</h2>
          <Prose markdown={x.body} />
        </section>
      ))}
      {ask && (
        <section style={S.exchange}>
          <h2 style={S.exchangeHead}>
            {ask.question}
            <Thinking> answering…</Thinking>
          </h2>
          {ask.inquiry && ask.inquiry.verb.kind !== "settled" && (
            <InquiryRow inquiry={ask.inquiry} closing={false} />
          )}
          {ask.body && (
            <>
              <Prose markdown={ask.body} />
              <span className="fn-caret" />
            </>
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
  title: { font: `600 31px/1.22 ${font.ui}`, letterSpacing: "-.022em", margin: "0 0 6px", textWrap: "balance" },
  byline: {
    font: `12.5px ${font.ui}`, color: color.faint, margin: "0 0 18px",
    display: "flex", gap: 14, alignItems: "baseline",
  },
  action: {
    font: `600 12px ${font.ui}`, color: color.dim, background: color.card,
    border: `1px solid ${color.line}`, borderRadius: radius.control,
    padding: "4px 10px", cursor: "pointer",
  },
  marks: { margin: "0 0 16px", display: "flex", flexDirection: "column", gap: 5 },
  mark: {
    font: `12.5px/1.5 ${font.ui}`, color: color.wait, background: color.waitWash,
    border: "1px solid #EBDCAC", borderRadius: radius.card, padding: "7px 12px", margin: 0,
  },
  thinkToggle: {
    font: `600 12px ${font.ui}`, color: color.dim, background: "none", border: 0,
    padding: 0, cursor: "pointer", marginBottom: 10,
  },
  thinking: {
    font: `12.5px/1.6 ${font.ui}`, color: color.faint, whiteSpace: "pre-wrap",
    borderLeft: `2px solid ${color.line}`, padding: "2px 0 2px 12px", margin: "0 0 18px",
  },
  exchange: { borderTop: `1px solid ${color.line}`, margin: "26px 0 0", paddingTop: 18 },
  exchangeHead: {
    font: `italic 600 16px/1.4 ${font.ui}`, letterSpacing: "-.008em", margin: "0 0 10px",
  },
};
