/** The evidence the question carried, shown where the question is.
 *
 *  These are the ADMITTED REPRESENTATIONS — the bytes the model was actually
 *  given. The content plane serves nothing else on purpose: raw blobs answer
 *  HEAD only, so a retained source layer can never be handed out by mistake.
 *  For an image under the pixel ceiling normalization returns the file
 *  byte-identical, so this usually IS what you dropped; where it differs the
 *  image was too large, rotated by its EXIF tag, or carried a non-sRGB
 *  profile — the cases where what the model saw is the honest thing to show,
 *  because it is what the brief rests on. */
import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { color, font, radius, shadow } from "../theme.js";
import { useBrief } from "../store.js";
import { selectSeen } from "../select.js";

const short = (digest: string): string => digest.replace(/^sha256:/, "").slice(0, 10);

export function Figures(): ReactElement | null {
  const seen = useBrief(selectSeen);
  return <FigureStrip digests={seen} />;
}

/** The strip itself, source-agnostic: the root brief passes its question's
 *  media, each exchange passes its own — the evidence sits beside the
 *  question that carried it, in thread order. */
export function FigureStrip({ digests }: { digests: string[] }): ReactElement | null {
  const src = window.harness.representationUrl;
  const [open, setOpen] = useState<string | null>(null);
  // Read off the loaded element rather than the wire: the descriptor carries a
  // byte length, never pixels, and this is the representation's true size.
  const [dims, setDims] = useState<Record<string, string>>({});

  if (digests.length === 0 || !src) return null;

  return (
    <>
      <div style={S.strip}>
        {digests.map((digest) => (
          <button
            key={digest}
            type="button"
            style={S.figure}
            title="Enlarge"
            onClick={() => setOpen(digest)}
          >
            <img
              src={src(digest)}
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
        ))}
      </div>
      <p style={S.caption}>
        what the model saw
        {digests.length === 1 && dims[digests[0]] ? ` · ${dims[digests[0]]}` : ""}
        {" · click to enlarge"}
      </p>

      {open !== null && (
        <Lightbox digest={open} dims={dims[open]} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

/** The full-size view, shared by the figure strip and the run bar's marker so
 *  there is one enlarged image in the app rather than two that drift. */
export function Lightbox({ digest, dims, onClose }: {
  digest: string;
  dims?: string;
  onClose: () => void;
}): ReactElement | null {
  const src = window.harness.representationUrl;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!src) return null;
  return (
    <div
      style={S.scrim}
      role="dialog"
      aria-modal="true"
      aria-label="Attached image, full size"
      onClick={onClose}
    >
      <img src={src(digest)} alt="Attached image, as the model received it" style={S.full} />
      <p style={S.fullCaption}>
        what the model saw{dims ? ` · ${dims}` : ""} · {short(digest)}
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
  fullCaption: { font: `12px ${font.ui}`, color: "#D8D8D2", margin: 0 },
};
