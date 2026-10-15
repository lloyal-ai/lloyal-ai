import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** A stable text projection for prose references, shared by the view and owner.
 * Markdown syntax is not part of a quoted sentence; the saved answer is immutable.
 */
export function proseText(markdown: string): string {
  return toString(
    fromMarkdown(markdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }),
  );
}
