/** The brief's prose — markdown from the harness (already inline-cited by
 *  the weave), set in the document's one face; links open outward. Carries
 *  the document's whole type system: the model's own headings step DOWN
 *  from the document title (size and spacing make the hierarchy; weight
 *  never exceeds 600 — emphasis included, so a bold-happy model can't
 *  shout), links whisper under a hairline, quotes and code sit in the
 *  register. With an `anchorPrefix`, headings carry the ids `anchorsOf`
 *  derives — the same pure list the outline rail reads, indexed in render
 *  order. With `citations` (url → ordinal), a cited link grows its chip;
 *  a link whose whole text is a bare "[1]" collapses into the chip. */
import { memo, type CSSProperties, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { color, font, radius } from "../theme.js";
import { anchorsOf } from "../select.js";

const textOf = (node: ReactNode): string =>
  typeof node === "string" ? node
  : Array.isArray(node) ? node.map(textOf).join("")
  : "";

/** The heading scale, stepping down from the document's 31px title. */
const HEADING: Record<"h1" | "h2" | "h3" | "h4", CSSProperties> = {
  h1: { font: `600 21px/1.3 ${font.ui}`, letterSpacing: "-.014em", margin: "30px 0 10px", textWrap: "balance" },
  h2: { font: `600 18px/1.35 ${font.ui}`, letterSpacing: "-.012em", margin: "26px 0 8px", textWrap: "balance" },
  h3: { font: `600 16px/1.4 ${font.ui}`, letterSpacing: "-.008em", margin: "20px 0 6px" },
  h4: { font: `600 14px/1.4 ${font.ui}`, margin: "16px 0 5px" },
};

/** Memoized on its props: settled sections keep their parse while a
 *  sibling streams — only the growing block re-renders per token. */
export const Prose = memo(function Prose({ markdown: raw, anchorPrefix, citations }: {
  markdown: string;
  anchorPrefix?: string;
  citations?: Map<string, number>;
}): ReactElement {
  // Models sometimes wrap a woven link in literal brackets — shed them.
  const markdown = raw.replace(/\[(\[[^\]]*\]\([^)]*\))\]/g, "$1");
  const anchors = anchorPrefix ? anchorsOf(markdown, anchorPrefix) : [];
  let next = 0;
  const anchored = (Tag: "h1" | "h2" | "h3" | "h4") =>
    ({ children }: { children?: ReactNode }): ReactElement =>
      <Tag id={anchors[next++]?.anchor} style={HEADING[Tag]}>{children}</Tag>;
  return (
    <div style={S.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const ordinal = href ? citations?.get(href) : undefined;
            if (ordinal === undefined) {
              return (
                <a href={href} target="_blank" rel="noreferrer" style={S.link}>
                  {children}
                </a>
              );
            }
            const bare = /^\[?\d+\]?$/.test(textOf(children).trim());
            // A corpus citation's target is a local file — chip without a
            // dead hyperlink; the sources grid carries its card.
            if (!/^https?:\/\//.test(href ?? "")) {
              return (
                <span style={S.citeLink}>
                  {!bare && children}
                  <sup style={S.cite}>{ordinal}</sup>
                </span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" style={S.citeLink}>
                {!bare && children}
                <sup style={S.cite}>{ordinal}</sup>
              </a>
            );
          },
          h1: anchored("h1"), h2: anchored("h2"), h3: anchored("h3"), h4: anchored("h4"),
          p: ({ children }) => <p style={S.p}>{children}</p>,
          strong: ({ children }) => <strong style={S.strong}>{children}</strong>,
          blockquote: ({ children }) => <blockquote style={S.quote}>{children}</blockquote>,
          code: ({ children, className }) =>
            className ? (
              <code className={className} style={S.codeBlock}>{children}</code>
            ) : (
              <code style={S.code}>{children}</code>
            ),
          pre: ({ children }) => <pre style={S.pre}>{children}</pre>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
});

const S: Record<string, CSSProperties> = {
  prose: { font: `400 15.5px/1.72 ${font.ui}`, color: color.ink },
  p: { margin: "0 0 14px" },
  // Emphasis, not shouting — a bold-happy model still reads as prose.
  strong: { fontWeight: 600 },
  // Links whisper: a hairline under the words, the words keep the accent.
  link: {
    color: color.emberDeep, textDecoration: "underline", textDecorationThickness: 1,
    textDecorationColor: "#E4B7A8", textUnderlineOffset: 3,
  },
  citeLink: { textDecoration: "none", color: "inherit" },
  cite: {
    font: `600 10px/1 ${font.ui}`, color: color.emberDeep, background: color.emberWash,
    borderRadius: radius.pill, padding: "2px 5px", marginLeft: 2, verticalAlign: "super",
  },
  quote: {
    margin: "0 0 14px", padding: "2px 0 2px 14px",
    borderLeft: `3px solid ${color.line}`, color: color.dim, fontStyle: "italic",
  },
  code: {
    font: `13px ${font.mono}`, background: color.card2, borderRadius: 5,
    padding: "1px 5px",
  },
  codeBlock: { font: `12.5px/1.6 ${font.mono}`, background: "none", padding: 0 },
  pre: {
    margin: "0 0 14px", padding: "12px 14px", background: color.card2,
    border: `1px solid ${color.line}`, borderRadius: radius.card, overflowX: "auto",
  },
};
