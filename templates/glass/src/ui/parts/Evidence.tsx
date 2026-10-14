import { useState } from "react";
import { DisclosureHeading } from "./DisclosureHeading.js";
import {
  Lightbox,
  pageFacts,
  useAssets,
  useContentOrigin,
} from "@lloyal-labs/ui";
import { representationUrl, sourceUrl } from "@lloyal-labs/media";
import type { Descriptor } from "@lloyal-labs/media";
export function Evidence({
  roots,
  viewed = [],
  references = roots,
}: {
  roots: readonly Descriptor[];
  viewed?: readonly Descriptor[];
  references?: readonly Descriptor[];
}) {
  const origin = useContentOrigin(),
    assets = useAssets(
      [...references, ...roots, ...viewed].map((r) => r.digest),
    );
  const [open, setOpen] = useState<{
    digest?: string;
    pdf?: string;
    label: string;
  } | null>(null);
  // Empty origin means same-origin routing in the web target; only null is unavailable.
  if (origin === null || (!roots.length && !viewed.length)) return null;
  const seen = new Set(viewed.map((a) => a.digest)),
    originals = new Set(roots.map((r) => r.digest));
  const labels = new Map<string, string>();
  for (const root of references) {
    const asset = assets[root.digest];
    if (asset?.kind !== "document") continue;
    for (const p of asset.meta.pages)
      if (p.render)
        labels.set(p.render.digest, `${asset.meta.title} · page ${p.page}`);
    for (const f of asset.meta.figures)
      labels.set(
        f.root.digest,
        `${asset.meta.title} · page ${f.page} · figure ${f.index}${f.caption ? " · " + f.caption : ""}`,
      );
  }
  const image = (r: Descriptor, label: string) => (
    <button
      type="button"
      key={r.digest}
      className="gc-viewed"
      aria-label={
        label + (seen.has(r.digest) ? " · viewed by model" : " · preview")
      }
      onClick={() =>
        setOpen({
          digest: r.digest,
          label:
            label +
            (seen.has(r.digest) ? " · what the model saw" : " · preview"),
        })
      }
    >
      <img src={representationUrl(origin, r.digest)} alt="" />
      <small className="gc-preview-label">{label}</small>
      {seen.has(r.digest) && (
        <span className="gc-viewed-status">Viewed by model</span>
      )}
    </button>
  );
  return (
    <div className="gc-evidence">
      <div className="gc-attachment-strip">
        {roots.map((r) => {
          const asset = assets[r.digest];
          if (!asset)
            return (
              <div className="gc-file-card" key={r.digest} role="status">
                Loading source…
              </div>
            );
          if (asset.kind === "document")
            return (
              <details key={r.digest} className="gc-file-card" open>
                <summary className="gc-disclosure gc-file-summary">
                  <DisclosureHeading
                    meta={`${asset.meta.pageCount} pages · PDF`}
                  >
                    {asset.meta.title}
                  </DisclosureHeading>
                </summary>
                <div className="gc-file-actions">
                  {asset.source && (
                    <button
                      type="button"
                      className="gc-small gc-open-original"
                      onClick={() =>
                        setOpen({
                          pdf: sourceUrl(origin, r.digest),
                          label: asset.meta.title + " · original PDF",
                        })
                      }
                    >
                      Open original
                    </button>
                  )}
                  {asset.source && (
                    <a
                      className="gc-small"
                      href={sourceUrl(origin, r.digest)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open PDF in new tab
                    </a>
                  )}
                  <a
                    className="gc-small"
                    href={representationUrl(origin, r.digest)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Extracted text
                  </a>
                </div>
                <div className="gc-file-facts">
                  {pageFacts(asset.meta, seen).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
                {asset.meta.derive.truncated && (
                  <p className="gc-file-warning">
                    Some text, pages or figures were outside the extraction
                    limits.
                  </p>
                )}
                <div
                  className="gc-pages"
                  role="region"
                  aria-label={`Pages of ${asset.meta.title}`}
                  tabIndex={0}
                >
                  {asset.meta.pages.flatMap((p) =>
                    p.render ? [image(p.render, `Page ${p.page}`)] : [],
                  )}
                </div>
                {!!asset.meta.figures.length && (
                  <details className="gc-evidence-section">
                    <summary className="gc-disclosure">
                      <DisclosureHeading meta={asset.meta.figures.length}>
                        Figures
                      </DisclosureHeading>
                    </summary>
                    <div
                      className="gc-pages"
                      role="region"
                      aria-label={`Figures from ${asset.meta.title}`}
                      tabIndex={0}
                    >
                      {asset.meta.figures.map((f) =>
                        image(
                          f.root,
                          `Page ${f.page} · figure ${f.index}${f.caption ? " · " + f.caption : ""}`,
                        ),
                      )}
                    </div>
                  </details>
                )}
              </details>
            );
          return image(r, "Attached image");
        })}
      </div>
      {viewed.some((r) => !originals.has(r.digest)) && (
        <details className="gc-evidence-section">
          <summary className="gc-disclosure">
            <DisclosureHeading
              meta={viewed.filter((r) => !originals.has(r.digest)).length}
            >
              What the model saw
            </DisclosureHeading>
          </summary>
          <div className="gc-attachment-strip">
            {viewed
              .filter((r) => !originals.has(r.digest))
              .map((r) => image(r, labels.get(r.digest) ?? "Admitted image"))}
          </div>
        </details>
      )}
      {open && (
        <Lightbox
          {...open}
          onClose={() => setOpen(null)}
          styles={{
            caption: {
              font: "13px Inter,sans-serif",
              color: "#aeb9d3",
              margin: 0,
            },
          }}
        />
      )}
    </div>
  );
}
