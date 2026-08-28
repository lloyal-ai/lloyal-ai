/** The application shell: sidebar (wordmark · library · trust), run bar,
 *  canvas, and the docked composer. Moments render inside the canvas. */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { color, font, radius, thinking } from "../theme.js";
import { send, useBrief } from "../store.js";
import {
  etaOf, selectControls, selectDepth, selectElapsed, selectLive,
  selectRunShape, selectStatus, selectTaskCount, selectTitle,
} from "../select.js";
import { paceFor } from "../pace.js";

export function Wordmark(): ReactElement {
  return (
    <div style={S.brand}>
      <span style={S.mark}>
        f<em style={S.upright}>(</em>n<em style={S.upright}>)</em>
      </span>
      <span style={S.divider} />
      Field Note
    </div>
  );
}

export function TrustStrip({ detail }: { detail?: string }): ReactElement {
  return (
    <div style={S.trust}>
      <span className="fn-lamp" style={S.lamp} />
      <span>Working locally — nothing leaves this machine{detail ? ` · ${detail}` : ""}</span>
    </div>
  );
}

function RunBar(): ReactElement {
  const live = useBrief(selectLive);
  const status = useBrief(selectStatus);
  const title = useBrief(selectTitle);
  const { paused, closing } = useBrief(selectControls);
  const depth = useBrief(selectDepth);
  const shape = useBrief(selectRunShape);
  const tasks = useBrief(selectTaskCount);
  const elapsed = useBrief(selectElapsed);
  const eta = live ? etaOf(paceFor(depth, shape), tasks, elapsed) : null;
  const word = live && closing ? "Closing" : live && paused ? "Held" : status;
  return (
    <div style={S.runbar}>
      <span style={S.status}>
        {live && (
          <span
            className={paused ? undefined : "fn-lamp"}
            style={{ ...S.lamp, background: paused ? color.wait : color.ember }}
          />
        )}
        {word}
      </span>
      {title && <span style={S.runTitle}>{title}</span>}
      <span style={{ flex: 1 }} />
      {live && eta && !paused && !closing && <span style={S.eta}>{eta.label}</span>}
      {live && (
        <>
          <button
            type="button"
            style={{ ...S.control, ...(closing ? S.controlOff : null) }}
            disabled={closing}
            title={closing ? "the brief is closing" : paused ? "the next step continues from here" : "hold the run — everything stays in place"}
            onClick={() => send({ type: paused ? "resume" : "pause" })}
          >
            {paused ? "▶ Resume" : "⏸ Hold"}
          </button>
          <button
            type="button"
            style={{ ...S.control, ...(paused || closing ? S.controlOff : null) }}
            disabled={paused || closing}
            title={closing ? "closing" : paused ? "resume first" : "settle the brief with what it has"}
            onClick={() => send({ type: "wrap_up" })}
          >
            {closing ? "Closing…" : "Close the brief"}
          </button>
        </>
      )}
      {live && eta && (
        <span style={{ ...S.progress, width: `${Math.round(eta.fraction * 100)}%` }} />
      )}
    </div>
  );
}

export function Shell({ children, dock }: { children: ReactNode; dock: ReactNode }): ReactElement {
  return (
    <div style={S.app}>
      <style>{KEYFRAMES}</style>
      <aside style={S.side}>
        <Wordmark />
        <div style={{ flex: 1 }} />
        <div style={S.sideFoot}>
          <TrustStrip />
        </div>
      </aside>
      <div style={S.main}>
        <RunBar />
        <div style={S.canvas}>{children}</div>
        <div style={S.dock}>{dock}</div>
      </div>
    </div>
  );
}

/** The gradient sweep is reserved for live model streams. */
export function Thinking({ children }: { children: ReactNode }): ReactElement {
  return <span className="fn-think">{children}</span>;
}

const KEYFRAMES = `
  .fn-lamp { animation: fn-pulse 2.4s ease-in-out infinite; }
  .fn-caret { display:inline-block; width:2.5px; height:15px; background:${color.ember};
    vertical-align:-2px; margin-left:2px; animation: fn-blink 1s steps(2) infinite; }
  .fn-think { background:${thinking}; -webkit-background-clip:text; background-clip:text;
    color:transparent; background-size:200% 100%; animation: fn-sweep 2.6s linear infinite; font-weight:500; }
  @keyframes fn-pulse { 50% { opacity:.35; } }
  @keyframes fn-blink { 50% { opacity:0; } }
  @keyframes fn-sweep { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .fn-lamp, .fn-caret { animation:none; }
    .fn-think { animation:none; background:none; color:${color.dim}; }
  }
  a { color:${color.emberDeep}; }
`;

const S: Record<string, CSSProperties> = {
  // Fills its container — the dev shell owns the viewport and reserves its
  // own status-bar row, so 100dvh here would push the dock under it.
  app: {
    display: "flex", height: "100%", minHeight: 0, background: color.ground,
    color: color.ink, font: `13.5px/1.55 ${font.ui}`,
  },
  side: {
    width: 232, flex: "none", background: color.panel, borderRight: `1px solid ${color.line}`,
    padding: "18px 14px 14px", display: "flex", flexDirection: "column",
  },
  brand: { display: "flex", alignItems: "center", gap: 9, padding: "2px 6px", font: `600 14.5px ${font.ui}` },
  mark: { font: `italic 700 20px/1 ${font.math}`, color: color.ink },
  upright: { fontStyle: "normal", fontWeight: 600, fontSize: "1.04em" },
  divider: { width: 1, height: 14, background: "#C6C6BE", flex: "none" },
  sideFoot: { borderTop: `1px solid ${color.line}`, paddingTop: 11, fontSize: 12, lineHeight: 1.4 },
  trust: { display: "flex", alignItems: "center", gap: 8, color: color.dim, fontSize: 12 },
  lamp: { width: 7, height: 7, borderRadius: "50%", background: color.ok, flex: "none" },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  runbar: {
    height: 48, display: "flex", alignItems: "center", gap: 13, padding: "0 26px",
    borderBottom: `1px solid ${color.line}`, fontSize: 13, color: color.dim, flex: "none",
    position: "relative",
  },
  eta: { color: color.faint, whiteSpace: "nowrap" },
  control: {
    font: `600 12.5px ${font.ui}`, background: color.card, color: color.ink,
    border: `1px solid ${color.line}`, borderRadius: radius.control,
    padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap",
  },
  controlOff: { opacity: 0.45, cursor: "default" },
  progress: {
    position: "absolute", left: 0, bottom: -1, height: 2, background: thinking,
    borderRadius: 2, transition: "width .6s ease",
  },
  status: { display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: color.ink },
  runTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  canvas: { flex: 1, overflowY: "auto", padding: "40px 0 34px", position: "relative" },
  dock: { padding: "12px 26px 18px", borderTop: `1px solid ${color.line}`, flex: "none" },
};

export const doc: CSSProperties = {
  width: "94ch", maxWidth: "calc(100% - 92px)", margin: "0 auto", position: "relative",
};

export { radius };
