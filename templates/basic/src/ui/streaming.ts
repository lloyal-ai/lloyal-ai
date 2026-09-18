/** Where streaming prose stops being finished. Everything before the last blank line outside an open code
 *  fence is complete blocks, parsed once and kept while they stand; what follows is the block still being
 *  written, parsed per token. Not a parser: a boundary this misjudges (a loose list, say) costs one extra
 *  parse of one block, never a wrong document. */
export function splitStreaming(markdown: string): { head: string; tail: string } {
  // A fence toggles at each line that opens one — indented up to three spaces at the top level, further
  // inside a list item; an odd count leaves one open, and the tail must begin at or before its opening line
  // so the fence is parsed whole. Fence lengths are not matched: a shorter fence inside a longer one
  // toggles here, at the cost of one wrong split until settle.
  let open = false;
  let openedAt = 0;
  const fence = /^[ \t]*(?:```|~~~)/gm;
  for (let m = fence.exec(markdown); m !== null; m = fence.exec(markdown)) {
    open = !open;
    if (open) openedAt = m.index;
  }
  const cut = markdown.lastIndexOf("\n\n", open ? openedAt - 2 : markdown.length);
  if (cut < 0) return { head: "", tail: markdown };
  return { head: markdown.slice(0, cut + 2), tail: markdown.slice(cut + 2) };
}
