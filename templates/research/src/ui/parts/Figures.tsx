/** The evidence the question carried, shown where the question is.
 *
 *  An image shows as the ADMITTED REPRESENTATION — the bytes the model was
 *  actually given, read through its manifest, so a retained source layer is
 *  never shown in its place. For an image under the pixel ceiling normalization returns the
 *  file byte-identical, so this usually IS what you dropped; where it differs
 *  the image was too large, rotated by its EXIF tag, or carried a non-sRGB
 *  profile — the cases where what the model saw is the honest thing to show,
 *  because it is what the brief rests on.
 *
 *  A document shows as a card — its title, its page count, its first page —
 *  because what the model was given is its text, and a page image is what the
 *  model looks at only when a tool puts one in front of it.
 *
 *  A video shows as its poster over the frames the model saw, on their
 *  timeline, with what the soundtrack said beneath; opening it plays the file
 *  as attached beside those frames. */
import { useState, type CSSProperties, type ReactElement } from "react";
import { Lightbox as UiLightbox, pageFacts, resolveAsset, useAssets, useContentOrigin, useProjection } from "@lloyal-labs/ui";
import type { Asset, LightboxProps } from "@lloyal-labs/ui";
import { representationUrl, sourceUrl } from "@lloyal-labs/media";
import { color, font, radius, shadow } from "../theme.js";
import { selectSeen, selectThreadDigests } from "../select.js";
import { LIGHTBOX } from "./Prose.js";

export { pageFacts, resolveAsset, useAssets };
export type { Asset };

type VideoAsset = Extract<Asset, { kind: "video" }>;

/** The enlarged view of a video: the original when it was kept, the frames the model saw, what was said. */
export function videoView(origin: string, digest: string, asset: VideoAsset, atMs?: number): NonNullable<LightboxProps["video"]> {
  return {
    ...(asset.source ? { src: sourceUrl(origin, digest) } : {}),
    frames: asset.meta.frames.map((f) => ({ src: representationUrl(origin, digest, f.frame), tMs: f.tMs })),
    ...(asset.transcript ? { transcript: asset.transcript.segments } : {}),
    ...(atMs !== undefined ? { atMs } : {}),
  };
}

const clock = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** ui's enlarged view, in this document's register — one for the strip, the run bar's marker and a cited page. */
export const Lightbox = (props: Omit<LightboxProps, "styles">): ReactElement | null => <UiLightbox {...props} styles={LIGHTBOX} />;

export function Figures(): ReactElement | null {
  const seen = useProjection(selectSeen);
  return <FigureStrip digests={seen} />;
}

/** The strip itself, source-agnostic: the root brief passes its question's
 *  media, each exchange passes its own — the evidence sits beside the
 *  question that carried it, in thread order. */
export function FigureStrip({ digests }: { digests: string[] }): ReactElement | null {
  const origin = useContentOrigin();
  const assets = useAssets(digests);
  // Page renders the thread holds — admitted by a tool, persisted with the run —
  // say which pages the model looked at.
  const threadDigests = useProjection(selectThreadDigests);
  const [open, setOpen] = useState<
    { digest: string; label?: string } | { pdf: string; label: string } | { video: NonNullable<LightboxProps["video"]>; label: string } | null
  >(null);
  // Read off the loaded element rather than the wire: the descriptor carries a
  // byte length, never pixels, and this is the representation's true size.
  const [dims, setDims] = useState<Record<string, string>>({});

  if (digests.length === 0 || origin === null) return null;
  const anyDocument = digests.some((d) => assets[d]?.kind === "document");
  const anyHeard = digests.some((d) => { const a = assets[d]; return a?.kind === "video" && a.transcript !== undefined; });

  return (
    <>
      <div style={S.strip}>
        {digests.map((digest) => {
          const asset = assets[digest];
          if (asset?.kind === "document") {
            const { meta } = asset;
            const cover = meta.pages.find((p) => p.page === 1)?.render;
            const facts = pageFacts(meta, new Set(threadDigests));
            // The card opens the document itself in the browser's PDF viewer
            // when the ingest kept the original; else its first page render.
            const openIt = (): void => {
              if (asset.source) setOpen({ pdf: sourceUrl(origin, digest), label: meta.title });
              else if (cover) setOpen({ digest: cover.digest, label: `${meta.title} · page 1` });
            };
            return (
              <button
                key={digest}
                type="button"
                style={{ ...S.card, cursor: asset.source || cover ? "zoom-in" : "default" }}
                title={asset.source ? `${meta.title} — open the PDF` : meta.title}
                onClick={openIt}
              >
                {/* The first page, full bleed; the facts read over it from the bottom. */}
                {cover
                  ? <img src={representationUrl(origin, cover.digest)} alt="" style={S.cover} />
                  : <span style={S.coverBlank} aria-hidden="true">PDF</span>}
                <span style={S.overlay}>
                  <span style={S.cardTitle}>{meta.title}</span>
                  <span style={S.cardMeta}>{meta.pageCount} page{meta.pageCount === 1 ? "" : "s"} · PDF</span>
                  {facts.map((line) => <span key={line} style={S.cardMeta}>{line}</span>)}
                </span>
              </button>
            );
          }
          if (asset?.kind === "video") {
            const { meta, transcript } = asset;
            const said = transcript?.segments.map((t) => t.text).join(" ");
            return (
              <button
                key={digest}
                type="button"
                style={S.videoCard}
                title={asset.source ? "Play the video beside the frames the model saw" : "The frames the model saw"}
                onClick={() => setOpen({ video: videoView(origin, digest, asset), label: `video · ${clock(meta.durationMs)}` })}
              >
                <img src={representationUrl(origin, digest, meta.poster)} alt="The video's first frame" style={S.poster} />
                <span style={S.timeline} aria-hidden="true">
                  {meta.frames.map((f) => (
                    <img key={f.tMs} src={representationUrl(origin, digest, f.frame)} alt="" style={S.tick} />
                  ))}
                </span>
                <span style={S.videoMeta}>
                  {clock(meta.durationMs)} · {meta.frames.length} frame{meta.frames.length === 1 ? "" : "s"}
                  {said ? <span style={S.said}>“{said}”</span> : null}
                </span>
              </button>
            );
          }
          return (
            <button
              key={digest}
              type="button"
              style={S.figure}
              title="Enlarge"
              onClick={() => setOpen({ digest })}
            >
              <img
                src={representationUrl(origin, digest)}
                alt="Attached image, as the model received it"
                style={S.img}
                onLoad={(e) => {
                  // Read the element NOW. `currentTarget` is only valid while the
                  // event is dispatching — React nulls it afterwards, and a state
                  // updater runs later, so reading it in there throws and takes
                  // the whole tree down with it.
                  const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                  setDims((d) => (d[digest] ? d : { ...d, [digest]: `${w}×${h}` }));
                }}
              />
            </button>
          );
        })}
      </div>
      <p style={S.caption}>
        {anyDocument ? "what the model was given" : anyHeard ? "what the model saw and heard" : "what the model saw"}
        {digests.length === 1 && dims[digests[0]] ? ` · ${dims[digests[0]]}` : ""}
        {" · click to enlarge"}
      </p>

      {open !== null && ("pdf" in open
        ? <Lightbox pdf={open.pdf} label={open.label} onClose={() => setOpen(null)} />
        : "video" in open
          ? <Lightbox video={open.video} label={open.label} onClose={() => setOpen(null)} />
          : <Lightbox digest={open.digest} dims={dims[open.digest]} label={open.label} onClose={() => setOpen(null)} />)}
    </>
  );
}

const S: Record<string, CSSProperties> = {
  strip: { display: "flex", flexWrap: "wrap", gap: 10, margin: "0 0 6px" },
  figure: {
    padding: 0, border: `1px solid ${color.line}`, borderRadius: radius.panel,
    background: color.card, boxShadow: shadow.card, cursor: "zoom-in",
    overflow: "hidden", lineHeight: 0, flex: "none",
  },
  img: { display: "block", maxWidth: 260, maxHeight: 200, objectFit: "contain" },
  // A document card: one size for every document, the first-page render
  // filling it edge to edge and cropped from the bottom when its shape differs
  // (`object-fit: cover`, the image-element form of `background-size: cover`).
  // The title and the page facts read in white over a grey gradient that
  // fades up from the bottom — a gradient alone, no backdrop blur: a blur is
  // a property of the panel's box and clips hard at its top edge, which read
  // as the page ending in a grey slab.
  card: {
    position: "relative", display: "block", width: 200, height: 262, padding: 0, lineHeight: 0,
    border: `1px solid ${color.line}`, borderRadius: radius.panel, overflow: "hidden",
    background: color.card, boxShadow: shadow.card, flex: "none", textAlign: "left",
  },
  cover: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    objectFit: "cover", objectPosition: "top", background: "#fff",
  },
  coverBlank: {
    position: "absolute", inset: 0, display: "grid", placeItems: "center", lineHeight: 1,
    font: `600 22px ${font.ui}`, letterSpacing: ".08em", color: color.dim, background: color.card2,
  },
  // Translucent, not dark: the page stays readable through the panel. The
  // blur carries the legibility, the shadow the contrast, so the grey itself
  // can stay light.
  overlay: {
    position: "absolute", left: 0, right: 0, bottom: 0, lineHeight: 1.3,
    display: "flex", flexDirection: "column", gap: 2, padding: "26px 11px 10px",
    background: "linear-gradient(to top, rgba(40,40,46,.74) 0%, rgba(40,40,46,.6) 50%, rgba(40,40,46,0) 100%)",
    color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.45)",
  },
  cardTitle: {
    font: `600 12.5px/1.3 ${font.ui}`, color: "#fff",
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  cardMeta: { font: `11px/1.35 ${font.ui}`, color: "rgba(255,255,255,.92)" },
  caption: { font: `12px ${font.ui}`, color: color.dim, margin: "0 0 18px" },
  // A video card: the poster, then the frames on their timeline, then length and what was said.
  videoCard: {
    display: "flex", flexDirection: "column", gap: 6, width: 260, padding: 6, cursor: "zoom-in", textAlign: "left",
    border: `1px solid ${color.line}`, borderRadius: radius.panel, background: color.card, boxShadow: shadow.card, flex: "none",
  },
  poster: { display: "block", width: "100%", maxHeight: 160, objectFit: "contain", borderRadius: 8, background: "#000" },
  timeline: { display: "flex", gap: 2, overflow: "hidden" },
  tick: { height: 22, flex: "1 1 0", minWidth: 0, objectFit: "cover", borderRadius: 2 },
  videoMeta: { display: "flex", flexDirection: "column", gap: 3, font: `11.5px/1.35 ${font.ui}`, color: color.dim, padding: "0 2px 2px" },
  said: { color: color.ink, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" },
};
