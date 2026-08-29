/** One line of inquiry, working beneath its section: identity, its current
 *  verb, the honest park countdown, and — while live — the stop square that
 *  culls it. The row opens on click to disclose the whole stream, so slow
 *  hardware still shows its work. Settled rows fade; nothing floats. */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { color, font, inquiryColor, radius, shadow } from "../theme.js";
import { send, useBrief } from "../store.js";
import { selectDev, selectWorkFor, type Inquiry, type WorkStep } from "../select.js";

export function InquiryRow({ inquiry, closing, label }: {
  inquiry: Inquiry;
  closing: boolean;
  /** Overrides the "Inquiry N" identity — the probes name their source. */
  label?: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const dev = useBrief(selectDev);
  const { verb } = inquiry;
  const live = inquiry.endedAt === null && verb.kind !== "failed";
  const identity = inquiryColor(inquiry.index);

  return (
    <>
      <div
        style={{
          ...S.row,
          ...(verb.kind === "waiting" ? S.waiting : null),
          ...(live ? null : S.done),
          ...(open ? S.rowOpen : null),
        }}
        title={open ? undefined : "Show the work"}
        onClick={() => setOpen((o) => !o)}
      >
        {live && verb.kind !== "waiting" && <span className="fn-lamp" style={{ ...S.dot, background: color.ember }} />}
        <span style={{ ...S.who, color: identity }}>{label ?? `Inquiry ${inquiry.index + 1}`}</span>
        {dev && <span style={S.ref}>(#{inquiry.id})</span>}
        <span style={S.verb}>
          {verb.kind === "waiting" ? <Park text={verb.text} retryAt={verb.retryAt ?? 0} closing={closing} /> : verb.text}
        </span>
        {verb.kind === "settled" && <span style={{ ...S.pill, background: color.okWash, color: color.ok }}>✓</span>}
        {verb.kind === "failed" && <span style={{ ...S.pill, background: "#F7E2DF", color: color.danger }}>✕</span>}
        {live && (
          <button
            type="button"
            style={S.stop}
            title="Drop this inquiry — its section is left out"
            onClick={(e) => {
              e.stopPropagation();
              send({ type: "cancel_agent", agentId: inquiry.id });
            }}
          >
            <i style={S.stopGlyph} />
          </button>
        )}
        <button type="button" style={S.disclose} aria-expanded={open} aria-label="show the work">
          {open ? "▾" : "▸"}
        </button>
      </div>
      {open && <Work id={inquiry.id} />}
    </>
  );
}

/** The disclosed stream — the model's own work, live: thoughts as they
 *  arrive, each call and result, the raw tokens of the move being written.
 *  Follows the tail. */
export function Work({ id }: { id: number }): ReactElement {
  const steps = useBrief(selectWorkFor(id));
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pane.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps]);
  return (
    <div ref={pane} style={S.work}>
      {steps.map((s, i) => (
        <p key={i} style={{ ...S.step, ...STEP_STYLE[s.kind] }}>
          {s.text}
          {s.live && <span className="fn-caret" />}
        </p>
      ))}
      {steps.length === 0 && <p style={{ ...S.step, ...STEP_STYLE.thought }}>getting started…</p>}
    </div>
  );
}

/** The park, counting down for real — and the honest way out. */
function Park({ text, retryAt, closing }: { text: string; retryAt: number; closing: boolean }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return (
    <>
      {text} — {left > 0 ? `retrying in ${left}s` : "retrying…"}
      {!closing && <span style={{ color: color.dim }}> Closing the brief keeps what's already here.</span>}
    </>
  );
}

const STEP_STYLE: Record<WorkStep["kind"], CSSProperties> = {
  thought: { fontStyle: "italic", color: color.dim },
  call: { color: color.dim, fontWeight: 500 },
  result: { color: color.dim, fontWeight: 500 },
  tokens: { color: color.dim, fontFamily: font.mono, fontSize: 11.5 },
};

const S: Record<string, CSSProperties> = {
  row: {
    background: color.card, border: `1px solid ${color.line}`, borderRadius: radius.card,
    boxShadow: shadow.card, padding: "10px 13px", display: "flex", alignItems: "center",
    gap: 10, font: `13px ${font.ui}`, margin: "4px 0 10px", cursor: "pointer",
  },
  rowOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, margin: "4px 0 0" },
  waiting: { background: color.waitWash, borderColor: "#EBDCAC", color: color.wait },
  done: { opacity: 0.6, boxShadow: "none" },
  dot: { width: 7, height: 7, borderRadius: "50%", flex: "none" },
  who: { fontWeight: 700, flex: "none", letterSpacing: "-.01em" },
  ref: { color: color.dim, fontSize: 11.5, fontVariantNumeric: "tabular-nums" },
  verb: { color: "inherit", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pill: { font: `600 11px ${font.ui}`, borderRadius: radius.pill, padding: "3px 8px", flex: "none" },
  stop: {
    width: 22, height: 22, borderRadius: 7, border: `1px solid ${color.line}`,
    background: color.card, display: "grid", placeItems: "center", cursor: "pointer", flex: "none",
  },
  stopGlyph: { width: 8, height: 8, background: color.dim, borderRadius: 2, display: "block" },
  disclose: {
    font: `10px ${font.ui}`, color: color.dim, background: "none", border: 0,
    cursor: "pointer", flex: "none", padding: 2,
  },
  work: {
    margin: "0 0 10px", padding: "10px 13px", maxHeight: 240, overflowY: "auto",
    background: color.card2, border: `1px solid ${color.line}`, borderTop: 0,
    borderRadius: `0 0 ${radius.card}px ${radius.card}px`,
    font: `12.5px/1.6 ${font.ui}`, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
  },
  step: { margin: "0 0 6px" },
};
