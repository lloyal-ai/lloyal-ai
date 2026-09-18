/** Where streaming prose stops being finished. Everything before the last blank line outside an open code
 *  fence is complete blocks, parsed once and kept while they stand; what follows is the block still being
 *  written, parsed per token. Not a parser: a boundary this misjudges (a loose list, say) costs one extra
 *  parse of one block, never a wrong document. */
export function splitStreaming(markdown: string): { head: string; tail: string } {
  // A fence opens at a line of three or more backticks or tildes (indented up to three spaces at the top
  // level, further inside a list item) and closes only at a line of the same character at least as long,
  // as CommonMark has it. If one is open, the tail must begin at or before its opening line so the fence is
  // parsed whole.
  let open: { char: string; length: number; at: number } | null = null;
  const fence = /^[ \t]*(`{3,}|~{3,})/gm;
  for (let m = fence.exec(markdown); m !== null; m = fence.exec(markdown)) {
    const run = m[1];
    if (open === null) open = { char: run[0], length: run.length, at: m.index };
    else if (run[0] === open.char && run.length >= open.length) open = null;
  }
  const cut = markdown.lastIndexOf("\n\n", open ? open.at - 2 : markdown.length);
  if (cut < 0) return { head: "", tail: markdown };
  return { head: markdown.slice(0, cut + 2), tail: markdown.slice(cut + 2) };
}
