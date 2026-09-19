/** Where streaming prose stops being finished. Everything up to the last block CommonMark recognises is
 *  complete, parsed once and kept while it stands; the last block is the one still being written, parsed per
 *  token. The boundaries are marked's — a spec-tested block tokenizer, used here only to find where the last
 *  block starts: a loose list is one block, a fence owns its blank lines, a reference definition stands alone.
 *  A block boundary this misjudges would cost one extra parse of one block, never a wrong document. */
import { lexer } from "marked";

export function splitStreaming(markdown: string): { head: string; tail: string } {
  // marked reports raw text with line endings normalised; normalise first so head + tail is the text parsed.
  const text = markdown.replace(/\r\n?/g, "\n");
  const tokens = lexer(text);
  if (tokens.length < 2) return { head: "", tail: text };
  const cut = text.length - tokens[tokens.length - 1].raw.length;
  return { head: text.slice(0, cut), tail: text.slice(cut) };
}
