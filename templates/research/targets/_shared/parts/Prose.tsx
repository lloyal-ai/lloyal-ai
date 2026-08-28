/** The brief's prose — the one place the serif lives. Markdown from the
 *  harness (already inline-cited by the weave) rendered in the document's
 *  voice; links open outward. */
import type { CSSProperties, ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { color, font } from "../theme.js";

export function Prose({ markdown }: { markdown: string }): ReactElement {
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
}

const S: Record<string, CSSProperties> = {
  prose: { font: `400 16px/1.72 ${font.serif}`, color: color.ink },
};
