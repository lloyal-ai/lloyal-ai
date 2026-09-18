/** Where streaming prose stops being finished. Everything before the last blank line outside an open code
 *  fence is complete blocks, parsed once and kept while they stand; what follows is the block still being
 *  written, parsed per token. Not a parser: a boundary this misjudges (a loose list, say) costs one extra
 *  parse of one block, never a wrong document. */
export function splitStreaming(markdown: string): { head: string; tail: string } {
  // A fence opens at a line of three or more backticks or tildes (indented up to three spaces at the top
  // level, further inside a list item; an info string may follow) and closes only at a line of the same
  // character at least as long with nothing but whitespace after it, as CommonMark has it. If one is open,
  // the tail must begin at or before its opening line so the fence is parsed whole.
  let open: { char: string; length: number; at: number } | null = null;
  const fence = /^[ \t]*(`{3,}|~{3,})(.*?)\r?$/gm;
  for (let m = fence.exec(markdown); m !== null; m = fence.exec(markdown)) {
    const run = m[1];
    if (open === null) open = { char: run[0], length: run.length, at: m.index };
    else if (run[0] === open.char && run.length >= open.length && m[2].trim() === "") open = null;
  }
  // A blank line is a line of nothing but whitespace, however it ends; the last one before the limit is
  // the cut, and the head keeps its exact bytes.
  const limit = open ? open.at : markdown.length;
  const blank = /\r?\n[ \t]*\r?\n/g;
  let cut = -1;
  for (let m = blank.exec(markdown); m !== null && m.index + m[0].length <= limit; m = blank.exec(markdown)) {
    cut = m.index + m[0].length;
  }
  if (cut < 0) return { head: "", tail: markdown };
  return { head: markdown.slice(0, cut), tail: markdown.slice(cut) };
}
