import { memo, useState } from "react";
import { Lightbox, Markdown, useAssets } from "@lloyal-labs/ui";
import { parseAttachmentHref, resolvePrefix } from "@lloyal-labs/media";
import { splitStreaming } from "@lloyal-labs/ui/prose";
export const Prose = memo(function Prose({
  markdown,
  digests = [],
}: {
  markdown: string;
  digests?: string[];
}) {
  const assets = useAssets(digests),
    [open, setOpen] = useState<{ digest: string; label: string } | null>(null);
  return (
    <>
      <Markdown
        markdown={markdown}
        components={{
          a: ({ href, children }) => {
            const cited = href ? parseAttachmentHref(href) : null;
            if (cited) {
              const root = resolvePrefix(cited.prefix, digests),
                asset = root ? assets[root] : undefined;
              const page =
                asset?.kind === "document"
                  ? asset.meta.pages.find((p) => p.page === cited.page)
                  : null;
              return page?.render ? (
                <button
                  type="button"
                  className="gc-citation"
                  onClick={() =>
                    setOpen({
                      digest: page.render!.digest,
                      label:
                        (asset?.kind === "document"
                          ? asset.meta.title
                          : "Source") +
                        " · page " +
                        cited.page +
                        " · source preview",
                    })
                  }
                >
                  {children}
                </button>
              ) : (
                <span title="Source unavailable in this conversation">
                  {children}
                </span>
              );
            }
            return /^https?:\/\//.test(href ?? "") ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
        }}
      />
      {open && <Lightbox {...open} onClose={() => setOpen(null)} />}
    </>
  );
});
export function StreamingProse({
  markdown,
  digests,
}: {
  markdown: string;
  digests?: string[];
}) {
  const { head, tail } = splitStreaming(markdown);
  return (
    <>
      {head && <Prose markdown={head} digests={digests} />}
      <Prose markdown={tail} digests={digests} />
    </>
  );
}
