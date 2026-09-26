/**
 * The tsconfig files, edited through the library that owns the format. They are JSONC — the templates'
 * guidance lives in comments — so `jsonc-parser` (what VS Code reads its own settings with) parses them, finds
 * the array an edit names, and produces the minimal text edit that replaces it, leaving every comment outside
 * the array as it was. Nothing here reads the text itself.
 *
 * An edit is PREPARED — the file read and the result computed — and answers the write, so a verb that changes
 * other files can find a file that is not there, or not what it edits, before anything else has changed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';

/** An edit prepared and not yet landed: everything it will write is computed; calling it writes. */
export type Write = () => void;

/** The templates' own layout: two-space indent, one entry per line. */
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };

/** The array under `key`, as strings — empty when the key is absent or not an array. */
function stringArray(text: string, file: string, key: string): string[] | undefined {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  if (!tree || errors.length > 0) throw new Error(`${file}: not valid JSONC`);
  const node = findNodeAtLocation(tree, [key]);
  if (!node || node.type !== 'array') return undefined;
  return (getNodeValue(node) as unknown[]).filter((v): v is string => typeof v === 'string');
}

/** Read the string entries of a `"key"` array (empty if absent). */
export function readJsoncArray(filePath: string, key: string): string[] {
  return stringArray(readFileSync(filePath, 'utf8'), filePath, key) ?? [];
}

/** The write that sets `key` to `entries` in `text`, landing at `writeTo`. */
function prepareSet(text: string, key: string, entries: readonly string[], writeTo: string): Write {
  const out = applyEdits(text, modify(text, [key], [...entries], FORMAT));
  return () => writeFileSync(writeTo, out);
}

/**
 * Keep only the entries for which `keep(entry)` is true. The file is read now — a missing one refuses here —
 * and written by the answer, to `writeTo` when that is elsewhere (the template's file, filtered, into the
 * project). A file without the array is passed through.
 */
export function prepareFilter(filePath: string, key: string, keep: (entry: string) => boolean, writeTo: string = filePath): Write {
  const text = readFileSync(filePath, 'utf8');
  const entries = stringArray(text, filePath, key);
  if (!entries) return writeTo === filePath ? () => {} : () => writeFileSync(writeTo, text);
  return prepareSet(text, key, entries.filter(keep), writeTo);
}

/**
 * Add `newEntries` to the `"key"` array, deduped against what is there. The inverse of {@link prepareFilter}.
 * A file without the array, or nothing new to add, is left as it is.
 */
export function prepareMerge(filePath: string, key: string, newEntries: readonly string[]): Write {
  const text = readFileSync(filePath, 'utf8');
  const entries = stringArray(text, filePath, key);
  if (!entries) return () => {};
  const toAdd = newEntries.filter((e) => !entries.includes(e));
  if (toAdd.length === 0) return () => {};
  return prepareSet(text, key, [...entries, ...toAdd], filePath);
}
