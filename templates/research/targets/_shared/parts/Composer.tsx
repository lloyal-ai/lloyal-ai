/** The docked composer: one field, depth in honest minutes, send. It answers
 *  the planner when the planner asked; otherwise it opens a brief in the
 *  chosen shape. Depth applies on selection (`set_effort` — next run). */
import { useState, type CSSProperties, type ReactElement } from "react";
import { color, font, radius, shadow } from "../theme.js";
import { send, useBrief } from "../store.js";
import { DEPTHS, SHAPES, selectDepth, type Shape } from "../select.js";

export function Composer({ shape, placeholder }: {
  shape: Shape;
  placeholder: string;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const depth = useBrief(selectDepth);
  const uiPhase = useBrief((app) => app.uiPhase);

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    if (uiPhase === "clarifying") send({ type: "submit_clarification", answer: text });
    else {
      const mode = SHAPES.find((s) => s.shape === shape)?.mode ?? "flat";
      // A question asked over a settled brief answers from the warm context
      // (skipPlanner) — instant, no fresh plan. A new topic reframes fully.
      send({ type: "submit_query", query: text, mode, skipPlanner: uiPhase === "done" });
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
      <div style={S.depths}>
        {DEPTHS.map((d) => (
          <button
            key={d.depth}
            type="button"
            style={d.depth === depth ? S.depthOn : S.depth}
            onClick={() => send({ type: "set_effort", effort: d.depth })}
          >
            {d.label}
          </button>
        ))}
      </div>
      <button type="button" style={S.send} onClick={submit} aria-label="Send">↑</button>
    </div>
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
