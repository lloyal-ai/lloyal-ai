/** Moment 02 — Frame. The question rises into the title and the outline
 *  drafts itself beneath it, live from the planner's own stream. While the
 *  harness holds the plan for review, editing IS editing the document:
 *  click a line to rewrite it, strike one, add one — each gesture a plan
 *  command — and the start holds while you edit. A clarify lands as the
 *  editor's query, in the document's voice. */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { color, font, inquiryColor } from "../theme.js";
import { send, useBrief } from "../store.js";
import {
  selectClarify, selectOutline, selectOutlineDraft, selectReviewing, selectTitle,
} from "../select.js";
import { Thinking, doc } from "../parts/Shell.js";

const START_HOLD_S = 5;

export function Frame(): ReactElement {
  const title = useBrief(selectTitle);
  const clarify = useBrief(selectClarify);
  const discovering = useBrief((app) => app.uiPhase === "discovering");
  const draft = useBrief(selectOutlineDraft);
  const outline = useBrief(selectOutline);
  const reviewing = useBrief(selectReviewing);

  return (
    <div style={doc}>
      <h1 style={S.title}>{title}</h1>

      {discovering && (
        <p style={S.beat}><Thinking>checking your libraries…</Thinking></p>
      )}

      {draft && (
        <>
          <p style={S.beat}><Thinking>drafting the outline…</Thinking></p>
          <div style={S.outline}>
            {draft.settled.map((line, i) => (
              <Line key={i} n={i + 1} text={line} />
            ))}
            {draft.partial !== null && (
              <Line n={draft.settled.length + 1} text={draft.partial} live />
            )}
          </div>
        </>
      )}

      {reviewing && <Review outline={outline} />}

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

function Line({ n, text, live }: { n: number; text: string; live?: boolean }): ReactElement {
  return (
    <div style={S.line}>
      <span style={{ ...S.lineN, color: inquiryColor(n - 1) }}>{n}</span>
      <span style={live ? { color: color.dim } : undefined}>
        {text}
        {live && <span className="fn-caret" />}
      </span>
    </div>
  );
}

/** The settled outline, held for review: a countdown starts the run and any
 *  edit holds it. Every gesture dispatches the harness's own plan command —
 *  the view keeps no plan state of its own. */
function Review({ outline }: { outline: string[] }): ReactElement {
  const [left, setLeft] = useState(START_HOLD_S);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");
  const accepted = useRef(false);

  const hold = editing !== null;
  useEffect(() => {
    if (hold) return;
    const t = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [hold]);

  useEffect(() => {
    if (left <= 0 && !accepted.current) {
      accepted.current = true;
      send({ type: "accept_plan" });
    }
  }, [left]);

  const start = (): void => {
    if (accepted.current) return;
    accepted.current = true;
    send({ type: "accept_plan" });
  };

  const beginEdit = (index: number): void => {
    setEditing(index);
    setDraftText(outline[index] ?? "");
    setLeft(START_HOLD_S);
  };

  const commitEdit = (): void => {
    const text = draftText.trim();
    if (editing !== null && text && text !== outline[editing]) {
      send({ type: "update_task_description", index: editing, description: text });
    }
    setEditing(null);
  };

  const strike = (index: number): void => {
    send({ type: "delete_task", index });
    setLeft(START_HOLD_S);
  };

  const add = (): void => {
    send({ type: "add_task", afterIndex: outline.length - 1 });
    setEditing(outline.length);
    setDraftText("");
    setLeft(START_HOLD_S);
  };

  return (
    <>
      <div style={S.outline}>
        {outline.map((line, i) => (
          <div key={i} style={S.reviewLine}>
            <span style={{ ...S.lineN, color: inquiryColor(i) }}>{i + 1}</span>
            {editing === i ? (
              <input
                autoFocus
                style={S.lineInput}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <button type="button" style={S.lineText} onClick={() => beginEdit(i)} title="Rewrite this line">
                {line}
              </button>
            )}
            {outline.length > 1 && (
              <button type="button" style={S.strike} onClick={() => strike(i)} title="Strike this line">
                ✕
              </button>
            )}
          </div>
        ))}
        <button type="button" style={S.addLine} onClick={add}>
          <span style={S.lineN}>＋</span>Add a line of inquiry…
        </button>
      </div>
      <div style={S.foot}>
        <span>
          {hold
            ? "Editing holds the start."
            : <>Starts in <b style={{ color: color.ink }}>{Math.max(0, left)}s</b> — editing holds it.</>}
        </span>
        <button type="button" style={S.startNow} onClick={start}>Start now</button>
      </div>
    </>
  );
}

const lineTextBase: CSSProperties = {
  font: "inherit", color: "inherit", background: "none", border: 0, padding: 0,
  textAlign: "left", cursor: "text", flex: 1, lineHeight: 1.5,
};

const S: Record<string, CSSProperties> = {
  title: { font: `600 31px/1.22 ${font.ui}`, letterSpacing: "-.022em", margin: "0 0 18px", textWrap: "balance" },
  beat: { font: `14px ${font.ui}`, margin: "0 0 16px" },
  outline: { display: "flex", flexDirection: "column", gap: 2 },
  line: {
    display: "flex", gap: 13, alignItems: "baseline", padding: "10px 13px",
    borderRadius: 10, fontSize: 14.5, lineHeight: 1.5,
  },
  reviewLine: {
    display: "flex", gap: 13, alignItems: "baseline", padding: "10px 13px",
    borderRadius: 10, fontSize: 14.5,
  },
  lineN: { font: `500 12px ${font.mono}`, flex: "none", width: 15, color: color.faint },
  lineText: lineTextBase,
  lineInput: {
    ...lineTextBase, cursor: "auto", outline: "none",
    borderBottom: `1px solid ${color.ember}`, background: color.card,
  },
  strike: {
    font: `11px ${font.ui}`, color: color.faint, background: color.card,
    border: `1px solid ${color.line}`, borderRadius: 7, width: 22, height: 22,
    cursor: "pointer", flex: "none",
  },
  addLine: {
    display: "flex", gap: 13, alignItems: "baseline", padding: "10px 13px",
    borderRadius: 10, fontSize: 14.5, color: color.faint, background: "none",
    border: `1px dashed ${color.line}`, cursor: "pointer", textAlign: "left", font: "inherit",
  },
  foot: {
    display: "flex", alignItems: "center", gap: 14, marginTop: 18,
    font: `13px ${font.ui}`, color: color.dim,
  },
  startNow: {
    font: `600 12.5px ${font.ui}`, background: color.ink, color: color.ground,
    border: `1px solid ${color.ink}`, borderRadius: 8, padding: "7px 13px", cursor: "pointer",
  },
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
