/**
 * The one place `harness.yml` is opened, read, edited or written.
 *
 * Nothing else in this CLI imports `yaml` or names the file — grep for either
 * and this module is the only hit, which is how a bypass stays visible. A
 * scaffolded `harness.yml` is a document people READ (three quarters of
 * basic's is guidance comments), so an edit that moves those comments has
 * broken it even when the YAML still parses.
 *
 * **Navigate by meaning, edit by bytes.** The Document model answers "what is
 * at `model.llm.id`" across every way a value may validly be spelled —
 * `{ id: x }`, `id: x`, `id: "x"` — and the CST underneath it carries the exact
 * source tokens. Setting a value rewrites that one token: indentation, quoting,
 * blank lines and comment positions cannot drift, because they are never
 * re-rendered. Re-rendering from the Document alone is what loses them — it
 * emits comments at the indentation of whichever node the parser attached them
 * to, which pulls a file's trailing guidance inside the last block.
 *
 * Every operation re-parses. These are small files edited once per command, so
 * the cost is nothing and the alternative is stale token offsets.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Composer, CST, Parser, isScalar } from 'yaml';
import type { Document } from 'yaml';

export const HARNESS_YML = 'harness.yml';

/** Where a project's manifest lives. The only construction of this path. */
export function harnessYmlPath(projectDir: string): string {
  return join(projectDir, HARNESS_YML);
}

/** Does this directory hold a harness manifest? */
export function hasHarnessYml(projectDir: string): boolean {
  return existsSync(harnessYmlPath(projectDir));
}

/** A path into the document, by key: `['model', 'llm', 'id']`. */
export type YmlPath = readonly string[];

/** An open manifest. Read freely; every mutator reports whether it applied. */
export interface HarnessYml {
  /** The value at `path`, or `undefined`. Reads every valid spelling. */
  get(path: YmlPath): unknown;
  /** Whether a node exists at `path` — true for an empty block, false for a commented one. */
  has(path: YmlPath): boolean;
  /**
   * Rewrite an existing scalar in place, byte-exact: only that token changes,
   * so a trailing comment on the same line survives. False when `path` names
   * no scalar — callers decide whether that is an insert or an error.
   */
  setScalar(path: YmlPath, value: string | number, opts?: { quoted?: boolean }): boolean;
  /** Rename an existing key in place, keeping its value and trailing comment. */
  renameKey(path: YmlPath, to: string): boolean;
  /** Add `lines` as the last children of the block at `parent`, at its children's indent. */
  insert(parent: YmlPath, lines: readonly string[]): void;
  /**
   * Make a commented hint live. The templates ship `# gpu: cuda` and the like
   * as guidance, so promoting one replaces that line rather than adding the key
   * beside a comment that now reads as its duplicate. Appends when there is no
   * hint to promote.
   *
   * This is the one operation that looks at comment TEXT, because a comment has
   * no structure to navigate — it is prose the parser hands back verbatim. The
   * search is bounded to the block's own span, so it cannot reach a `#` that
   * belongs to something else.
   */
  promote(parent: YmlPath, key: string, rendered: string): void;
  /** Replace the whole value at `path` with a rendered one-line scalar or flow collection. */
  setInline(path: YmlPath, rendered: string): boolean;
  /** Write back, only when something actually changed. */
  save(): void;
}

export function openHarnessYml(projectDir: string): HarnessYml {
  const ymlPath = harnessYmlPath(projectDir);
  const original = readFileSync(ymlPath, 'utf8');
  let text = original;

  /** The CST tokens and the Document that points back into them. */
  function parse(): { tokens: CST.Token[]; doc: Document } {
    const tokens = [...new Parser().parse(text)];
    const doc = [...new Composer({ keepSourceTokens: true }).compose(tokens)][0] as Document;
    return { tokens, doc };
  }

  /** Re-stringify the CST — the tokens carry their own source, so this is lossless. */
  const render = (tokens: CST.Token[]): string => tokens.map((t) => CST.stringify(t)).join('');

  return {
    get(path) {
      return parse().doc.getIn([...path]);
    },

    has(path) {
      return parse().doc.hasIn([...path]);
    },

    setScalar(path, value, opts = {}) {
      const { tokens, doc } = parse();
      const node = doc.getIn([...path], true);
      if (!isScalar(node) || !node.srcToken) return false;
      CST.setScalarValue(node.srcToken, String(value), {
        type: opts.quoted === true ? 'QUOTE_DOUBLE' : undefined,
      });
      text = render(tokens);
      return true;
    },

    renameKey(path, to) {
      const { tokens, doc } = parse();
      const parent = doc.getIn(path.slice(0, -1) as string[], true);
      const last = path[path.length - 1];
      // The key is a node too, with its own source token — renaming is the same
      // byte-level edit as setting a value, and leaves the pair where it sits.
      const pair =
        parent && typeof parent === 'object' && 'items' in parent
          ? (parent.items as { key?: unknown }[]).find(
              (p) => isScalar(p.key) && p.key.value === last,
            )
          : undefined;
      if (!pair || !isScalar(pair.key) || !pair.key.srcToken) return false;
      CST.setScalarValue(pair.key.srcToken, to);
      text = render(tokens);
      return true;
    },

    setInline(path, rendered) {
      const { doc } = parse();
      const node = doc.getIn([...path], true);
      const range = (node as { range?: [number, number, number] } | undefined)?.range;
      if (!range) return false;
      text = text.slice(0, range[0]) + rendered + text.slice(range[1]);
      return true;
    },

    insert(parent, lines) {
      const { doc } = parse();
      const block = doc.getIn([...parent], true) as { items?: Ranged[] } | null | undefined;
      const items = block && Array.isArray(block.items) ? block.items : [];
      const last = items.length > 0 ? items[items.length - 1] : undefined;

      let at: number;
      let indent: string;
      if (last?.key && last.value) {
        // A node's `range` is [start, valueEnd, nodeEnd]. `nodeEnd` swallows
        // every comment that trails the block — for `model:` in basic's
        // template that reaches the end of the file — so anchoring there would
        // write past the document. The LAST CHILD's `valueEnd` is where the
        // content actually stops, and is the start of the line after it.
        // `valueEnd` sits just PAST the newline when the value is a block (it
        // spans whole lines) and just BEFORE it when the value is a scalar, so
        // step to the start of the next line only when we are not already there.
        at = lineStartAfter(text, last.value.range[1]);
        // The siblings' indent, taken from the whitespace before the last key
        // rather than assumed, so a differently-indented manifest lines up.
        indent = lineIndent(text, last.key.range[0]);
      } else {
        // An empty block (`vision:` with nothing under it) has no sibling to
        // measure against, so anchor on its own key line, one level deeper.
        const own = pairAt(doc, parent);
        if (!own?.key) {
          throw new Error(`harness.yml: no \`${parent.join('.')}\` block to insert into`);
        }
        const keyStart = own.key.range[0];
        const eol = text.indexOf('\n', keyStart);
        at = eol === -1 ? text.length : eol + 1;
        indent = `${lineIndent(text, keyStart)}  `;
      }
      text = text.slice(0, at) + lines.map((l) => `${indent}${l}\n`).join('') + text.slice(at);
    },

    promote(parent, key, rendered) {
      const { doc } = parse();
      const own = pairAt(doc, parent);
      const block = doc.getIn([...parent], true) as { range?: [number, number, number] } | null;
      if (!own?.key || !block?.range) {
        throw new Error(`harness.yml: no \`${parent.join('.')}\` block to write into`);
      }
      const childIndent = `${lineIndent(text, own.key.range[0])}  `;
      // The block's span runs to `nodeEnd`, which covers its trailing comments;
      // walk it only while the lines still belong to this block.
      const span = text.slice(block.range[0], block.range[2]);
      const hint = new RegExp(`^${childIndent}#\\s*${key}:.*$`, 'm');
      const found = span.match(hint);
      if (found?.index !== undefined) {
        const at = block.range[0] + found.index;
        text = text.slice(0, at) + childIndent + rendered + text.slice(at + found[0].length);
        return;
      }
      this.insert(parent, [rendered]);
    },

    save() {
      if (text !== original) writeFileSync(ymlPath, text);
    },
  };
}

/** A map entry, as far as insertion cares: both halves carry source ranges. */
interface Ranged {
  key?: { range: [number, number, number] };
  value?: { range: [number, number, number] };
}

/** The whitespace before the line containing `offset`. */
function lineIndent(text: string, offset: number): string {
  return text.slice(text.lastIndexOf('\n', offset) + 1, offset);
}

/** The start of the line after `offset` — `offset` itself when it is already one. */
function lineStartAfter(text: string, offset: number): number {
  if (offset > 0 && text[offset - 1] === '\n') return offset;
  const nl = text.indexOf('\n', offset);
  return nl === -1 ? text.length : nl + 1;
}

/** The map entry AT `path` — the pair itself, not its value. */
function pairAt(doc: Document, path: YmlPath): Ranged | undefined {
  const owner = path.length > 1 ? doc.getIn(path.slice(0, -1) as string[], true) : doc.contents;
  const items = owner && typeof owner === 'object' && 'items' in owner ? owner.items : null;
  if (!Array.isArray(items)) return undefined;
  const name = path[path.length - 1];
  return (items as { key?: unknown }[]).find(
    (p) => isScalar(p.key) && p.key.value === name,
  ) as Ranged | undefined;
}
