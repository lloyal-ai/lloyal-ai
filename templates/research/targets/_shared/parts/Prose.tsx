/** The brief's prose — markdown from the harness (already inline-cited by
 *  the weave), set in the document's one face; links open outward. With an
 *  `anchorPrefix`, headings carry the ids `anchorsOf` derives — the same
 *  pure list the outline rail reads, indexed in render order. */
import { memo, type CSSProperties, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { color, font } from "../theme.js";
import { anchorsOf } from "../select.js";

/** Memoized on its props: settled sections keep their parse while a
 *  sibling streams — only the growing block re-renders per token. */
export const Prose = memo(function Prose({ markdown, anchorPrefix }: {
  markdown: string;
  anchorPrefix?: string;
}): ReactElement {
  const anchors = anchorPrefix ? anchorsOf(markdown, anchorPrefix) : [];
  let next = 0;
  const anchored = (Tag: "h1" | "h2" | "h3" | "h4") =>
    ({ children }: { children?: ReactNode }): ReactElement =>
      <Tag id={anchors[next++]?.anchor}>{children}</Tag>;
  return (
    <div style={S.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
          h1: anchored("h1"), h2: anchored("h2"), h3: anchored("h3"), h4: anchored("h4"),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
});

const S: Record<string, CSSProperties> = {
  prose: { font: `400 15.5px/1.7 ${font.ui}`, color: color.ink },
};
