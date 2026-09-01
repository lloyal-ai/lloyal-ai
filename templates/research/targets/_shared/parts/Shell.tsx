/** The application shell: sidebar (wordmark · library · trust), run bar,
 *  canvas, and the docked composer. Moments render inside the canvas. */
import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { color, font, radius, thinking } from "../theme.js";
import { send, useBrief, useConnection } from "../store.js";
import {
  etaOf, selectControls, selectDepth, selectElapsed, selectLive,
  selectNotice, selectRunShape, selectSeen, selectStatus, selectTaskCount, selectTitle,
} from "../select.js";
import { paceFor } from "../pace.js";
import { Lightbox } from "./Figures.js";

/** The mark, the name, and the control that puts the panel away. Collapsed, the
 *  name and the library go and the rail keeps only the mark and the control —
 *  so the way back is always the thing you just used. */
export function Wordmark({ collapsed = false, onToggle }: {
  collapsed?: boolean;
  onToggle?: () => void;
} = {}): ReactElement {
  return (
    <div style={{ ...S.brand, ...(collapsed ? S.brandRail : null) }}>
      <button
        type="button"
        style={S.markBtn}
        title="Start a new run"
        aria-label="Start a new run"
        onClick={() => send({ type: "new_run" })}
      >
        <span style={S.mark}>
          f<em style={S.upright}>(</em>n<em style={S.upright}>)</em>
        </span>
      </button>
      {!collapsed && (
        <>
          <span style={S.divider} />
          Field Note
          <span style={{ flex: 1 }} />
        </>
      )}
      {onToggle && (
        <button
          type="button"
          style={S.panelToggle}
          onClick={onToggle}
          title={collapsed ? "Show the library" : "Hide the library"}
          aria-label={collapsed ? "Show the library" : "Hide the library"}
          aria-expanded={!collapsed}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3.5" width="18" height="17" rx="2.5" />
            <line x1="9.5" y1="3.5" x2="9.5" y2="20.5" />
          </svg>
        </button>
      )}
    </div>
  );
}

const PANEL_KEY = "fieldnote.panel";
/** A per-viewer convenience, remembered but never load-bearing: a browser that
 *  refuses storage just opens expanded. */
const readCollapsed = (): boolean => {
  try {
    return (globalThis as { localStorage?: { getItem(k: string): string | null } })
      .localStorage?.getItem(PANEL_KEY) === "closed";
  } catch {
    return false;
  }
};
const writeCollapsed = (v: boolean): void => {
  try {
    (globalThis as { localStorage?: { setItem(k: string, v: string): void } })
      .localStorage?.setItem(PANEL_KEY, v ? "closed" : "open");
  } catch {
    /* private window, or storage refused — the panel simply forgets */
  }
};

export function TrustStrip({ detail }: { detail?: string }): ReactElement {
  return (
    <div style={S.trust}>
      <span className="fn-lamp" style={S.lamp} />
      <span>Working locally — nothing leaves this machine{detail ? ` · ${detail}` : ""}</span>
    </div>
  );
}

/** The run bar's marker: the figures live in the document under the question,
 *  but they scroll away, so this stays — and it opens the SAME enlarged view
 *  rather than a second one. */
function Seen(): ReactElement | null {
  const seen = useBrief(selectSeen);
  const src = window.harness.representationUrl;
  const [open, setOpen] = useState<string | null>(null);
  if (seen.length === 0 || !src) return null;
  return (
    <span style={S.seen}>
      {seen.map((id) => (
        <button
          key={id}
          type="button"
          style={S.seenBtn}
          title="What the model saw — enlarge"
          aria-label="Enlarge the attached image"
          onClick={() => setOpen(id)}
        >
          <img src={src(id)} alt="" style={S.seenImg} />
        </button>
      ))}
      {open !== null && <Lightbox digest={open} onClose={() => setOpen(null)} />}
    </span>
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
      <Seen />
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

export function Shell({ children, dock, library }: {
  children: ReactNode;
  dock: ReactNode;
  library?: ReactNode;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = (): void =>
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });
  return (
    <div style={S.app}>
      <style>{KEYFRAMES}</style>
      <aside style={{ ...S.side, ...(collapsed ? S.sideRail : null) }}>
        <Wordmark collapsed={collapsed} onToggle={toggle} />
        {!collapsed && library}
        <div style={{ flex: 1 }} />
        {!collapsed && (
          <div style={S.sideFoot}>
            <TrustStrip />
          </div>
        )}
      </aside>
      <div style={S.main}>
        <ConnectionBanner />
        <RunBar />
        <Notice />
        <div style={S.canvas}>{children}</div>
        <div style={S.dock}>{dock}</div>
      </div>
    </div>
  );
}

/** The link to the local host, made visible. When the socket drops the
 *  whole UI would otherwise go silently quiet — commands vanish, nothing
 *  streams — reading exactly like a frozen app. This says what actually
 *  happened and offers the one recovery (a reload re-opens a fresh session;
 *  the interrupted run does not survive, so we don't pretend it will). Only
 *  the web target reports status; elsewhere useConnection stays 'connected'. */
function ConnectionBanner(): ReactElement | null {
  const status = useConnection();
  if (status !== "lost") return null;
  return (
    <div role="alert" style={S.wire}>
      <span className="fn-lamp" style={{ ...S.lamp, background: color.danger }} />
      <span>Connection to the local host was lost — it may have stopped or restarted.</span>
      <button type="button" style={S.wireBtn} onClick={() => window.location.reload()}>
        Reconnect
      </button>
    </div>
  );
}

/** The one transient notice, docked under the run bar — a save
 *  confirmation, an error the run surfaced. Fades on its own; a new
 *  notice re-shows. Nothing in the register floats. */
function Notice(): ReactElement | null {
  const notice = useBrief(selectNotice);
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setExpired(notice.id), 6500);
    return () => clearTimeout(t);
  }, [notice?.id]);
  if (!notice || expired === notice.id) return null;
  return (
    <div role="status" style={{ ...S.notice, ...NOTICE_TONE[notice.tone] }}>
      {notice.message}
    </div>
  );
}

const NOTICE_TONE: Record<"info" | "success" | "warn" | "error", CSSProperties> = {
  info: {},
  success: { color: color.ok, background: color.okWash },
  warn: { color: color.wait, background: color.waitWash },
  error: { color: color.danger, background: "#F7E2DF" },
};

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
  /* Every control is a real button and always was tabbable — what was missing
     is somewhere for the eye to land, which reads as "tab does nothing".
     :focus-visible keeps the ring to keyboard use, so a click never draws it. */
  :focus-visible { outline:2px solid ${color.ember}; outline-offset:2px; border-radius:7px; }
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
    transition: "width .16s ease",
  },
  /** The rail keeps the panel's ground and border — the same panel narrowed,
   *  not different chrome — and holds only what reopens it. */
  sideRail: { width: 56, padding: "18px 8px 14px", alignItems: "center" },
  brand: { display: "flex", alignItems: "center", gap: 9, padding: "2px 6px", font: `600 14.5px ${font.ui}` },
  /** Collapsed: the mark over the control, both centred in the rail. */
  brandRail: { flexDirection: "column", gap: 14, padding: "2px 0" },
  markBtn: {
    background: "none", border: 0, padding: 0, cursor: "pointer",
    display: "inline-flex", flex: "none", borderRadius: 7,
  },
  panelToggle: {
    background: "none", border: 0, padding: 4, borderRadius: 7, cursor: "pointer",
    color: color.dim, display: "inline-flex", flex: "none",
  },
  seen: { display: "inline-flex", gap: 4, alignItems: "center", flex: "none", marginLeft: 8 },
  seenBtn: {
    padding: 0, border: 0, background: "none", cursor: "zoom-in",
    display: "inline-flex", lineHeight: 0, flex: "none",
  },
  seenImg: {
    height: 18, width: 18, objectFit: "cover", borderRadius: radius.control,
    border: `1px solid ${color.line}`, display: "block",
  },
  /** Math notation, not a logo. Georgia ships only 400 and 700, so `700 20px`
   *  had nowhere to go but heavy — and it outsized the 14.5px sans beside it by
   *  a third. The regular italic at 19px carries the same presence at the weight
   *  the notation wants; the half-pixel lift settles its optical baseline
   *  against the upright label. */
  mark: {
    font: `italic 400 19px/1 ${font.math}`, color: color.ink,
    letterSpacing: "0.005em", position: "relative", top: -0.5,
  },
  /** Parentheses stay upright — they are grouping, not the variable. Matching
   *  the italic's weight keeps the pair from reading as two typefaces. */
  upright: { fontStyle: "normal", fontWeight: 400, fontSize: "0.96em" },
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
  eta: { color: color.dim, whiteSpace: "nowrap" },
  wire: {
    display: "flex", alignItems: "center", gap: 10, flex: "none",
    font: `13px ${font.ui}`, color: color.danger, background: "#F7E2DF",
    borderBottom: `1px solid #E8C4BE`, padding: "9px 26px",
  },
  wireBtn: {
    marginLeft: "auto", font: `600 12px ${font.ui}`, color: color.ground,
    background: color.danger, border: 0, borderRadius: radius.control,
    padding: "5px 12px", cursor: "pointer",
  },
  notice: {
    font: `13px ${font.ui}`, color: color.dim, background: color.card2,
    borderBottom: `1px solid ${color.line}`, padding: "8px 26px", flex: "none",
  },
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
