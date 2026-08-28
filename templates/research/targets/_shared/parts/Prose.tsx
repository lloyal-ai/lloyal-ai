/** The brief's prose — markdown from the harness (already inline-cited by
 *  the weave), set in the document's one face; links open outward. */
import { memo, type CSSProperties, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { color, font } from "../theme.js";

/** Memoized on the markdown string: settled sections keep their parse while
 *  a sibling streams — only the growing block re-renders per token. */
export const Prose = memo(function Prose({ markdown }: { markdown: string }): ReactElement {
  return (
    <div style={S.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
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
