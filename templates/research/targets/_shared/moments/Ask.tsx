/** Moment 01 — Ask. One question on quiet paper and the shape choice. What
 *  the brief draws on lives in the dock beside the question, reachable at
 *  every moment. Boot renders here too, in the shell's voice: the loading
 *  spinner while weights come up. */
import type { CSSProperties, ReactElement } from "react";
import { color, font, radius, shadow } from "../theme.js";
import { useBrief } from "../store.js";
import { SHAPES, selectBoot, type Shape } from "../select.js";
import { Thinking } from "../parts/Shell.js";

/** The selected card's inline border always beats the hover class. */
const SHAPE_CSS = `
  .ask-shape { transition: border-color .12s ease, box-shadow .12s ease; }
  .ask-shape:hover { border-color: ${color.dim}; }
`;

export function Ask({ shape, onShape }: {
  shape: Shape;
  onShape: (shape: Shape) => void;
}): ReactElement {
  const boot = useBrief(selectBoot);

  return (
    <div style={S.center}>
      <style>{SHAPE_CSS}</style>
      <div style={S.aurora} />
      <div style={S.stack}>
        {boot.state === "quiet" && (
          <>
            <h1 style={S.h1}>What should we look into?</h1>
            <div style={S.shapes}>
              {SHAPES.map((s) => (
                <button
                  key={s.shape}
                  type="button"
                  className="ask-shape" style={s.shape === shape ? S.shapeOn : S.shape}
                  onClick={() => onShape(s.shape)}
                >
                  <b style={S.shapeTitle}>{s.title}</b>
                  <span style={S.shapeDetail}>{s.detail}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {boot.state === "loading" && (
          <div style={S.bootCard}>
            <Thinking>{boot.loadingLabel ?? "Loading"}…</Thinking>
          </div>
        )}

      </div>
    </div>
  );
}

const shapeBase: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start",
  textAlign: "left", background: color.card, border: `1px solid ${color.line}`,
  borderRadius: 12, padding: "11px 15px", minWidth: 220, cursor: "pointer",
};

const S: Record<string, CSSProperties> = {
  center: { minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center" },
  aurora: {
    position: "absolute", inset: 0, pointerEvents: "none",
    background:
      "radial-gradient(620px 320px at 50% 26%, rgba(221,107,74,.07), transparent 68%)," +
      "radial-gradient(460px 280px at 66% 10%, rgba(122,90,196,.05), transparent 70%)",
  },
  stack: { position: "relative", textAlign: "center", maxWidth: "60ch", padding: "0 24px" },
  h1: { font: `600 30px/1.3 ${font.ui}`, letterSpacing: "-.022em", margin: "0 0 9px" },
  byline: { font: `14px ${font.ui}`, color: color.dim, margin: 0 },
  lib: {
    font: `600 14px ${font.ui}`, color: color.ink, background: "none", border: 0,
    padding: 0, cursor: "pointer",
  },
  libOff: { color: color.dim, fontWeight: 400, textDecoration: "line-through" },
  shapes: { display: "flex", gap: 10, justifyContent: "center", marginTop: 26 },
  shape: shapeBase,
  shapeOn: { ...shapeBase, borderColor: color.ink, boxShadow: `0 0 0 1px ${color.ink}` },
  shapeTitle: { font: `600 13px ${font.ui}`, letterSpacing: "-.01em" },
  shapeDetail: { font: `12px ${font.ui}`, color: color.dim },
  bootCard: {
    background: color.card, border: `1px solid ${color.line}`, borderRadius: radius.panel,
    boxShadow: shadow.card, padding: "18px 22px", textAlign: "left", minWidth: 380,
  },
};
