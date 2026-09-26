/**
 * The one place `harness.yml` is opened, read, edited or written.
 *
 * Nothing else in this CLI imports `yaml` or names the file — grep for either
 * and this module is the only hit, which is how a bypass stays visible. And
 * this module never handles the text either: every read is a lookup on the
 * parsed document, every edit is a mutation of it, and the bytes written are
 * what the library renders from it. Braces, commas, indentation, quoting and
 * duplicate keys are the library's to get right — which is why `set` works the
 * same on `llm: { id: x }` as on a block, and why a value that needs quoting
 * gets it without this module knowing.
 *
 * The manifest's format is therefore the library's canonical one. The
 * templates are authored in it, so a scaffold round-trips byte for byte; a
 * hand-edited file keeps its meaning — and the text of any comments — and takes
 * the library's layout on the next write.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, isAlias, isMap, isNode, isScalar, isSeq } from 'yaml';

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

/** What an entry may hold. A list is written in flow style — `[cli, web]` — as the templates ship it. */
/** What a caller may set: a scalar, a flow list, or the empty mapping that requests a block (`vision: {}`). */
export type YmlValue = string | number | boolean | readonly string[] | Record<string, never>;

/** An open manifest: a document, edited in memory, rendered once on `save`. */
export interface HarnessYml {
  /** The value at `path` as plain data — a scalar, a list, a block — or `undefined`. Reads every valid spelling,
   *  and an alias as what it refers to. */
  get(path: YmlPath): unknown;
  /** Whether an entry exists at `path` — true for an empty block, false for a commented one. */
  has(path: YmlPath): boolean;
  /** Set `path` to `value`, creating each block on the way. An existing scalar is updated in place; an existing
   *  list keeps its node — and so its anchor, which an alias elsewhere in the file may still refer to. */
  set(path: YmlPath, value: YmlValue): void;
  /** Remove the entry at `path`. False when there was none. */
  remove(path: YmlPath): boolean;
  /** Rename the key at `path`, keeping its entry where it sits. Throws when `to` already exists beside it. */
  renameKey(path: YmlPath, to: string): void;
  /** Render the edited document now — refusing one the parser rejects — and answer the write, to land when the
   *  caller is ready. A verb that changes other files prepares this first, so a manifest that cannot be
   *  written is found before anything else has changed. */
  prepare(): () => void;
  /** `prepare()` and land it: render and write, only when something changed. */
  save(): void;
}

/** `[cli, desktop, web]` with no padding inside the brackets, and long values never folded. */
const RENDER = { lineWidth: 0, flowCollectionPadding: false } as const;

export function openHarnessYml(projectDir: string): HarnessYml {
  const ymlPath = harnessYmlPath(projectDir);
  const original = readFileSync(ymlPath, 'utf8');
  const doc = parseDocument(original);
  if (doc.errors.length > 0) throw new Error(`${ymlPath}: ${doc.errors[0].message}`);
  // Only an edit earns a write: a file opened to be read, or read and left as
  // it was, keeps its own layout rather than taking the library's.
  let edited = false;

  return {
    get(path) {
      const node = doc.getIn(path, true);
      const value = isAlias(node) ? node.resolve(doc) : node;
      return isNode(value) ? value.toJSON() : value;
    },
    has: (path) => doc.hasIn(path),

    set(path, value) {
      // A key with nothing under it (`vision:`) is a null scalar to the parser,
      // not a block, so nothing can be set beneath it until it is one.
      for (let depth = 1; depth < path.length; depth++) {
        const block = path.slice(0, depth);
        const node = doc.getIn(block, true);
        if (isScalar(node) && node.value === null) doc.setIn(block, doc.createNode({}));
      }
      const existing = doc.getIn(path, true);
      if (Array.isArray(value) && isSeq(existing)) {
        // The sequence node stays — its anchor with it — and only its items change.
        existing.items = value.map((item) => doc.createNode(item));
        existing.flow = true;
      } else {
        // A list and an empty mapping are created as flow nodes, so they render as they were asked for.
        doc.setIn(path, Array.isArray(value) || (typeof value === 'object' && value !== null) ? doc.createNode(value, { flow: true }) : value);
      }
      edited = true;
    },

    remove(path) {
      if (!doc.hasIn(path)) return false;
      edited = true;
      return doc.deleteIn(path);
    },

    renameKey(path, to) {
      const parentPath = path.slice(0, -1);
      const from = path[path.length - 1];
      const parent = doc.getIn(parentPath, true);
      if (!isMap(parent)) throw new Error(`${ymlPath}: no \`${parentPath.join('.')}\` block`);
      const pair = parent.items.find((p) => isScalar(p.key) && p.key.value === from);
      if (!pair || !isScalar(pair.key)) throw new Error(`${ymlPath}: no \`${path.join('.')}\` to rename`);
      if (parent.has(to)) throw new Error(`${ymlPath}: \`${[...parentPath, to].join('.')}\` already exists`);
      pair.key.value = to;
      edited = true;
    },

    prepare() {
      if (!edited) return () => {};
      const text = doc.toString(RENDER);
      if (text === original) return () => {};
      const check = parseDocument(text);
      if (check.errors.length > 0) {
        throw new Error(`${ymlPath}: refusing to write — the result does not parse: ${check.errors[0].message}`);
      }
      return () => writeFileSync(ymlPath, text);
    },

    save() {
      this.prepare()();
    },
  };
}
