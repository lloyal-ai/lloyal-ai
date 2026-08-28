/** Moment 01 — Ask. One question on quiet paper, the libraries the brief can
 *  draw on, and the shape choice. Boot renders here too, in the shell's
 *  voice: fetching the model, loading, the CUDA-pack offer, a failure. */
import type { CSSProperties, ReactElement } from "react";
import { color, font, radius, shadow } from "../theme.js";
import { send, useBrief } from "../store.js";
import {
  SHAPES, fmtBytes, selectBoot, selectLibraries, type Shape,
} from "../select.js";
import { Thinking } from "../parts/Shell.js";

export function Ask({ shape, onShape }: {
  shape: Shape;
  onShape: (shape: Shape) => void;
}): ReactElement {
  const boot = useBrief(selectBoot);
  const libraries = useBrief(selectLibraries);

  return (
    <div style={S.center}>
      <div style={S.aurora} />
      <div style={S.stack}>
        {boot.state === "quiet" && (
          <>
            <h1 style={S.h1}>What should we look into?</h1>
            {libraries.length > 0 && (
              <p style={S.byline}>
                Drawing on{" "}
                {libraries.map((l, i) => (
                  <span key={l.title}>
                    {i > 0 && (i === libraries.length - 1 ? " and " : ", ")}
                    <b style={S.libName}>{l.title}</b>
                    {l.detail ? ` (${l.detail})` : ""}
                  </span>
                ))}
                .
              </p>
            )}
            <div style={S.shapes}>
              {SHAPES.map((s) => (
                <button
                  key={s.shape}
                  type="button"
                  style={s.shape === shape ? S.shapeOn : S.shape}
                  onClick={() => onShape(s.shape)}
                >
                  <b style={S.shapeTitle}>{s.title}</b>
                  <span style={S.shapeDetail}>{s.detail}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {boot.state === "downloading" && (
          <div style={S.bootCard}>
            <Thinking>Fetching the model — a one-time download.</Thinking>
            {boot.downloads.map((d) => (
              <div key={d.label} style={S.dlRow}>
                <span style={S.dlLabel}>{d.label}</span>
                <span style={S.dlBar}>
                  <span style={{ ...S.dlFill, width: d.total > 0 ? `${(100 * d.got) / d.total}%` : 0 }} />
                </span>
                <span style={S.dlMeta}>
                  {d.total > 0 ? `${fmtBytes(d.got)} of ${fmtBytes(d.total)}` : "queued"}
                </span>
              </div>
            ))}
          </div>
        )}

        {boot.state === "loading" && (
          <div style={S.bootCard}>
            <Thinking>{boot.loadingLabel ?? "Loading"}…</Thinking>
          </div>
        )}

        {boot.state === "offer" && boot.offer && (
          <div style={S.bootCard}>
            <p style={S.offerHead}>Your {boot.offer.gpuName} can run this faster.</p>
            <p style={S.offerBody}>
              A one-time {fmtBytes(boot.offer.sizeBytes + (boot.offer.needsRuntime ? boot.offer.runtimeSizeBytes : 0))}{" "}
              download enables it. Everything still runs locally.
            </p>
            <div style={S.offerRow}>
              <button type="button" style={S.primary} onClick={() => send({ type: "accept_backend_pack" })}>
                Download
              </button>
              <button type="button" style={S.quiet} onClick={() => send({ type: "decline_backend_pack" })}>
                Not now
              </button>
            </div>
          </div>
        )}

        {boot.state === "error" && boot.error && (
          <div style={{ ...S.bootCard, borderColor: "#E8C4BE" }}>
            <p style={{ ...S.offerHead, color: color.danger }}>The {boot.error.kind} couldn't start.</p>
            <p style={S.offerBody}>{boot.error.message}</p>
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
  libName: { color: color.ink },
  shapes: { display: "flex", gap: 10, justifyContent: "center", marginTop: 26 },
  shape: shapeBase,
  shapeOn: { ...shapeBase, borderColor: color.ink, boxShadow: `0 0 0 1px ${color.ink}` },
  shapeTitle: { font: `600 13px ${font.ui}`, letterSpacing: "-.01em" },
  shapeDetail: { font: `12px ${font.ui}`, color: color.faint },
  bootCard: {
    background: color.card, border: `1px solid ${color.line}`, borderRadius: radius.panel,
    boxShadow: shadow.card, padding: "18px 22px", textAlign: "left", minWidth: 380,
  },
  dlRow: { display: "flex", alignItems: "center", gap: 12, marginTop: 14, fontSize: 12.5 },
  dlLabel: { width: 130, color: color.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dlBar: { flex: 1, height: 4, borderRadius: 2, background: color.card2, overflow: "hidden" },
  dlFill: { display: "block", height: "100%", background: color.ember, transition: "width .4s ease" },
  dlMeta: { color: color.faint, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  offerHead: { font: `600 15px ${font.ui}`, margin: "0 0 6px" },
  offerBody: { font: `13.5px/1.6 ${font.ui}`, color: color.dim, margin: "0 0 14px" },
  offerRow: { display: "flex", gap: 8 },
  primary: {
    font: `600 12.5px ${font.ui}`, background: color.ink, color: color.ground,
    border: `1px solid ${color.ink}`, borderRadius: radius.control, padding: "7px 13px", cursor: "pointer",
  },
  quiet: {
    font: `600 12.5px ${font.ui}`, background: color.card, color: color.dim,
    border: `1px solid ${color.line}`, borderRadius: radius.control, padding: "7px 13px", cursor: "pointer",
  },
};
