/** The docked composer: one field, the run's clock, depth priced in honest
 *  minutes for the plan at hand, send. It answers the planner when the
 *  planner asked; otherwise it opens a brief in the chosen shape. Over a
 *  settled brief it carries the Ask/Extend choice: Ask answers from the
 *  warm context (skipPlanner — instant); Extend reframes fully as a new
 *  run. Depth applies on selection (`set_effort` — next run). */
import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { color, font, radius, shadow } from "../theme.js";
import { send, useBrief } from "../store.js";
import {
  DEPTHS, SHAPES, estimateLabel, fmtElapsed, selectBanked,
  selectDepth, selectLive, selectMoment, selectResumedAt, selectTaskCount,
  type Shape,
} from "../select.js";
import { paceFor } from "../pace.js";
import type { AppState } from "../../../harness/state.js";

// Stable identities — the composer re-renders per keystroke, and a fresh
// inline closure per render would grow the fold's memo map (store contract).
const selectUiPhase = (app: AppState) => app.uiPhase;
const selectSettled = (app: AppState): boolean => selectMoment(app) === "settle";

const INTENTS = [
  { intent: "ask", label: "Ask", hint: "answers from the warm context — instant" },
  { intent: "extend", label: "Extend", hint: "a fresh brief that reframes fully" },
] as const;
type Intent = (typeof INTENTS)[number]["intent"];

export function Composer({ shape, placeholder }: {
  shape: Shape;
  placeholder: string;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [intent, setIntent] = useState<Intent>("ask");
  const depth = useBrief(selectDepth);
  const live = useBrief(selectLive);
  const tasks = useBrief(selectTaskCount);
  const uiPhase = useBrief(selectUiPhase);
  const settled = useBrief(selectSettled);

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    if (uiPhase === "clarifying") send({ type: "submit_clarification", answer: text });
    else {
      const mode = SHAPES.find((s) => s.shape === shape)?.mode ?? "flat";
      send({ type: "submit_query", query: text, mode, skipPlanner: settled && intent === "ask" });
    }
    setDraft("");
  };

  return (
    <div style={S.composer}>
      <input
        style={S.input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={placeholder}
      />
      {live && <Clock />}
      {settled && (
        <div style={S.depths}>
          {INTENTS.map((i) => (
            <button
              key={i.intent}
              type="button"
              style={i.intent === intent ? S.depthOn : S.depth}
              title={i.hint}
              onClick={() => setIntent(i.intent)}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
      <div style={S.depths}>
        {DEPTHS.map((d) => {
          const pace = paceFor(d.depth, shape);
          return (
            <button
              key={d.depth}
              type="button"
              style={d.depth === depth ? S.depthOn : S.depth}
              title={pace.observed ? undefined : "estimated — runs on this machine refine it"}
              onClick={() => send({ type: "set_effort", effort: d.depth })}
            >
              {d.title} · {estimateLabel(d.depth, tasks, pace)}
            </button>
          );
        })}
      </div>
      <button type="button" style={S.send} onClick={submit} aria-label="Send">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}

/** The run's wall clock, ticking beside the picker while work is live.
 *  Wall time is composed here, not in a selector — the fold's memo would
 *  freeze a Date.now() between events. */
function Clock(): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const banked = useBrief(selectBanked);
  const resumedAt = useBrief(selectResumedAt);
  const elapsed = banked + (resumedAt !== null ? Math.max(0, now - resumedAt) : 0);
  return (
    <span style={S.clock}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {fmtElapsed(elapsed)}
    </span>
  );
}

const depthBase: CSSProperties = {
  font: `600 12px ${font.ui}`, padding: "5px 11px", borderRadius: 7,
  border: 0, background: "none", color: color.dim, cursor: "pointer",
};

const S: Record<string, CSSProperties> = {
  composer: {
    background: color.card, border: `1px solid ${color.line}`, borderRadius: radius.panel,
    boxShadow: shadow.card, padding: "11px 13px", display: "flex", alignItems: "center", gap: 12,
  },
  input: {
    flex: 1, border: 0, outline: 0, font: `14.5px ${font.ui}`, color: color.ink,
    background: "none", minWidth: 0,
  },
  clock: {
    display: "inline-flex", alignItems: "center", gap: 5, flex: "none",
    font: `500 12px ${font.mono}`, color: color.dim, fontVariantNumeric: "tabular-nums",
  },
  depths: {
    display: "flex", gap: 3, background: color.card2, borderRadius: 9, padding: 3, flex: "none",
  },
  depth: depthBase,
  depthOn: { ...depthBase, background: color.ink, color: color.ground },
  send: {
    width: 33, height: 33, borderRadius: 9, background: color.ember, color: "#fff",
    border: 0, display: "grid", placeItems: "center", fontSize: 14, flex: "none", cursor: "pointer",
  },
};
