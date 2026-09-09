/** The evidence the question carried, shown where the question is.
 *
 *  An image shows as the ADMITTED REPRESENTATION — the bytes the model was
 *  actually given. The content plane serves nothing else on purpose: raw
 *  blobs answer HEAD only, so a retained source layer can never be handed out
 *  by mistake. For an image under the pixel ceiling normalization returns the
 *  file byte-identical, so this usually IS what you dropped; where it differs
 *  the image was too large, rotated by its EXIF tag, or carried a non-sRGB
 *  profile — the cases where what the model saw is the honest thing to show,
 *  because it is what the brief rests on.
 *
 *  A document shows as a card — its title, its page count, its first page —
 *  because what the model was given is its text, and a page image is what the
 *  model looks at only when a tool puts one in front of it. */
import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { asDocumentMeta, DOCUMENT_CONFIG_TYPE } from "@lloyal-labs/media";
import type { DocumentMeta } from "@lloyal-labs/media";
import { color, font, radius, shadow } from "../theme.js";
import { useBrief } from "../store.js";
import { selectSeen } from "../select.js";
import { selectThreadDigests } from "../select.js";
import { configUrl, contentOrigin, manifestUrl, representationUrl, sourceUrl } from "../content-urls.js";

const short = (digest: string): string => digest.replace(/^sha256:/, "").slice(0, 10);

/** What a root IS, learned from its manifest: a picture, or a document with its sidecar. */
export type Asset = { kind: "image" } | { kind: "document"; meta: DocumentMeta; /** The ingest retained the original file. */ source: boolean };

/** One resolution per digest for the page's lifetime: content is immutable
 *  under its address, so an answer never goes stale. A root whose manifest
 *  cannot be read is shown as an image — the failure is then visible (a
 *  broken picture) rather than silent. */
const resolved = new Map<string, Promise<Asset>>();
export async function resolveAsset(origin: string, digest: string): Promise<Asset> {
  try {
    const manifest = (await (await fetch(manifestUrl(origin, digest))).json()) as {
      config?: { mediaType?: string };
      layers?: { annotations?: Record<string, string> }[];
    };
    if (manifest.config?.mediaType !== DOCUMENT_CONFIG_TYPE) return { kind: "image" };
    const meta = asDocumentMeta(await (await fetch(configUrl(origin, digest))).json());
    if (!meta) return { kind: "image" };
    const source = (manifest.layers ?? []).some((l) => l.annotations?.["ai.lloyal.role"] === "source");
    return { kind: "document", meta, source };
  } catch {
    return { kind: "image" };
  }
}

/** "1, 2, 3, 7" with runs of three or more folded: "1–3, 7". */
function pageList(pages: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j - i >= 2 ? `${pages[i]}–${pages[j]}` : pages.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return out.join(", ");
}

/** What of a document reached the model, page by page: which pages had no
 *  text to extract (scanned — the model can only look at them), which were
 *  extracted as text, and — when the thread holds their renders — which pages
 *  the model actually looked at. */
export function pageFacts(meta: DocumentMeta, viewedRenders: ReadonlySet<string> = new Set()): string[] {
  const scanned = meta.pages.filter((p) => p.chars === 0).map((p) => p.page);
  const viewed = meta.pages.filter((p) => p.render && viewedRenders.has(p.render.digest)).map((p) => p.page);
  const n = meta.pageCount;
  const lines = [
    scanned.length === 0
      ? `Extracted as text: all ${n} page${n === 1 ? "" : "s"}`
      : scanned.length === n
        ? `Scanned (image only): all ${n} page${n === 1 ? "" : "s"}`
        : `Scanned: ${pageList(scanned)} · extracted as text: the rest`,
  ];
  if (viewed.length > 0) lines.push(`Viewed as images: ${pageList(viewed)}`);
  return lines;
}

/** The kinds of the given roots, filled in as the content plane answers. */
export function useAssets(digests: readonly string[]): Record<string, Asset> {
  const origin = contentOrigin();
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const key = digests.join(" ");
  useEffect(() => {
    if (origin === null) return;
    let live = true;
    for (const digest of key ? key.split(" ") : []) {
      let p = resolved.get(digest);
      if (!p) {
        p = resolveAsset(origin, digest);
        resolved.set(digest, p);
      }
      void p.then((asset) => {
        if (live) setAssets((prev) => (prev[digest] ? prev : { ...prev, [digest]: asset }));
      });
    }
    return () => { live = false; };
  }, [origin, key]);
  return assets;
}

export function Figures(): ReactElement | null {
  const seen = useBrief(selectSeen);
  return <FigureStrip digests={seen} />;
}

/** The strip itself, source-agnostic: the root brief passes its question's
 *  media, each exchange passes its own — the evidence sits beside the
 *  question that carried it, in thread order. */
export function FigureStrip({ digests }: { digests: string[] }): ReactElement | null {
  const origin = contentOrigin();
  const assets = useAssets(digests);
  // Page renders the thread holds — admitted by a tool, persisted with the run —
  // say which pages the model looked at.
  const threadDigests = useBrief(selectThreadDigests);
  const [open, setOpen] = useState<{ digest: string; label?: string } | { pdf: string; label: string } | null>(null);
  // Read off the loaded element rather than the wire: the descriptor carries a
  // byte length, never pixels, and this is the representation's true size.
  const [dims, setDims] = useState<Record<string, string>>({});

  if (digests.length === 0 || origin === null) return null;
  const anyDocument = digests.some((d) => assets[d]?.kind === "document");

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
        {anyDocument ? "what the model was given" : "what the model saw"}
        {digests.length === 1 && dims[digests[0]] ? ` · ${dims[digests[0]]}` : ""}
        {" · click to enlarge"}
      </p>

      {open !== null && ("pdf" in open
        ? <Lightbox pdf={open.pdf} label={open.label} onClose={() => setOpen(null)} />
        : <Lightbox digest={open.digest} dims={dims[open.digest]} label={open.label} onClose={() => setOpen(null)} />)}
    </>
  );
}

/** The full-size view, shared by the figure strip, the run bar's marker and a
 *  cited page in the prose, so there is one enlarged image in the app rather
 *  than three that drift. `digest` is the root of a single image — a photo the
 *  user attached, or a page render the document ingress archived. */
export function Lightbox({ digest, pdf, dims, label, onClose }: {
  /** The root of a single image to show — a photo, a page render. */
  digest?: string;
  /** Or a PDF to open in the browser's own viewer: the URL the content plane
   *  serves the original at, optionally at a page (`#page=N` is honoured). */
  pdf?: string;
  dims?: string;
  /** What is being shown, when it is not simply "the attached image". */
  label?: string;
  onClose: () => void;
}): ReactElement | null {
  const origin = contentOrigin();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (origin === null) return null;
  if (pdf !== undefined) {
    return (
      <div style={S.scrim} role="dialog" aria-modal="true" aria-label={label ?? "Attached document"} onClick={onClose}>
        {/* The viewer keeps its own clicks; the scrim around it closes. */}
        <iframe src={pdf} title={label ?? "Attached document"} style={S.pdf} onClick={(e) => e.stopPropagation()} />
        <p style={S.fullCaption}>{label ?? "the attached document"} · the file as attached</p>
      </div>
    );
  }
  if (digest === undefined) return null;
  return (
    <div
      style={S.scrim}
      role="dialog"
      aria-modal="true"
      aria-label={label ?? "Attached image, full size"}
      onClick={onClose}
    >
      <img src={representationUrl(origin, digest)} alt={label ?? "Attached image, as the model received it"} style={S.full} />
      <p style={S.fullCaption}>
        {label ?? "what the model saw"}{dims ? ` · ${dims}` : ""} · {short(digest)}
      </p>
    </div>
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
  scrim: {
    position: "fixed", inset: 0, zIndex: 50, cursor: "zoom-out",
    background: "rgba(20,20,22,.82)", display: "flex",
    flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
    padding: 32,
  },
  full: {
    maxWidth: "100%", maxHeight: "calc(100vh - 110px)", objectFit: "contain",
    borderRadius: radius.panel, background: color.card,
  },
  pdf: {
    width: "min(1100px, 94vw)", height: "calc(100vh - 110px)", border: 0,
    borderRadius: radius.panel, background: "#fff",
  },
  fullCaption: { font: `12px ${font.ui}`, color: "#D8D8D2", margin: 0 },
};
