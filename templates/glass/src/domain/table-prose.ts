import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

const parse = (text: string) =>
  fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
// Compare the complete inline syntax, including link destinations and formatting.
// A similar-looking table with different evidence must remain visible.
const signature = (nodes: unknown) =>
  JSON.stringify(nodes, (key, value) =>
    key === "position" ? undefined : value,
  );

/** Remove only an exact Markdown duplicate of an independently rendered typed table. */
export function withoutRepeatedTable(
  result: string,
  table?: { columns: string[]; rows: string[][] },
): string {
  if (!table) return result;
  const expected = [table.columns, ...table.rows].map((row) =>
    row.map((cell) => {
      const nodes = parse(cell).children;
      return nodes.length === 1 && nodes[0].type === "paragraph"
        ? signature(nodes[0].children)
        : null;
    }),
  );
  let clean = result;
  for (const node of [...parse(result).children].reverse()) {
    if (node.type !== "table" || node.children.length !== expected.length)
      continue;
    if (
      !node.children.every(
        (row, i) =>
          row.children.length === expected[i].length &&
          row.children.every(
            (cell, j) => signature(cell.children) === expected[i][j],
          ),
      )
    )
      continue;
    clean =
      clean.slice(0, node.position!.start.offset) +
      clean.slice(node.position!.end.offset);
  }
  return clean.trim();
}
