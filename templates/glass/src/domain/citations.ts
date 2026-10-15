import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

type Source = { title: string; url: string };
export function uniqueSources(sources: readonly Source[]): Source[] {
  const unique = new Map<string, Source>();
  for (const source of sources) {
    const title = source.title.trim(),
      url = source.url.trim();
    if (title && url && !unique.has(url)) unique.set(url, { title, url });
  }
  return [...unique.values()];
}

/** Separate only the framework's complete trailing bibliography from a display unit.
 * Inline links and their exact fragment/page destinations remain untouched. This
 * also presents older saved cells without rewriting the durable conversation.
 */
export function withoutSourceTrailer(
  markdown: string,
  sources: readonly Source[],
): string {
  const expected = uniqueSources(sources);
  if (!expected.length) return markdown;
  const nodes = fromMarkdown(markdown).children;
  const heading = nodes.at(-2),
    list = nodes.at(-1);
  if (
    heading?.type !== "paragraph" ||
    toString(heading) !== "Sources:" ||
    list?.type !== "list" ||
    list.children.length !== expected.length
  )
    return markdown;
  const urls = new Set<string>();
  for (const item of list.children) {
    if (item.children.length !== 1 || item.children[0].type !== "paragraph")
      return markdown;
    const children = item.children[0].children;
    if (children.length !== 1 || children[0].type !== "link") return markdown;
    const link = children[0];
    if (
      !expected.some((s) => s.url === link.url && s.title === toString(link)) ||
      urls.has(link.url)
    )
      return markdown;
    urls.add(link.url);
  }
  return markdown.slice(0, heading.position!.start.offset).trimEnd();
}
