import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openHarnessYml, hasHarnessYml, harnessYmlPath } from '../src/scaffold/harness-yml.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASIC = join(HERE, '..', 'templates', 'basic');

const created: string[] = [];
afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

/** A temp dir holding just the basic template's manifest. */
function fromTemplate(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hy-'));
  created.push(dir);
  cpSync(join(BASIC, 'harness.yml'), harnessYmlPath(dir));
  return dir;
}

/** A temp dir holding the given manifest text. */
function fromText(yml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hy-'));
  created.push(dir);
  writeFileSync(harnessYmlPath(dir), yml);
  return dir;
}

const read = (dir: string): string => readFileSync(harnessYmlPath(dir), 'utf8');

/** Lines that differ between two versions of a file — the blast radius of an edit. */
function changedLines(before: string, after: string): string[] {
  const b = before.split('\n');
  const a = after.split('\n');
  if (a.length !== b.length) return ['<line count changed>'];
  return a.filter((l, i) => l !== b[i]);
}

describe('harness.yml — reading', () => {
  // The line reader this module replaced matched only a double-quoted value in
  // a block map. The other two spellings are the same document.
  const SPELLINGS: ReadonlyArray<readonly [string, string]> = [
    ['inline flow', 'model:\n  llm: { id: "qwen3.5-4b" }\n'],
    ['unquoted', 'model:\n  llm:\n    id: qwen3.5-4b\n'],
    ['single-quoted', "model:\n  llm:\n    id: 'qwen3.5-4b'\n"],
    ['double-quoted', 'model:\n  llm:\n    id: "qwen3.5-4b"\n'],
  ];

  for (const [label, yml] of SPELLINGS) {
    it(`reads a value spelled ${label}`, () => {
      expect(openHarnessYml(fromText(yml)).get(['model', 'llm', 'id'])).toBe('qwen3.5-4b');
    });
  }

  it('a commented block is absent, not empty', () => {
    const y = openHarnessYml(fromTemplate());
    expect(y.has(['model', 'llm'])).toBe(true);
    expect(y.has(['model', 'reranker'])).toBe(false); // basic ships it commented
  });

  it('an EMPTY block is present — absence has to mean declined, not unconfigured', () => {
    const y = openHarnessYml(fromText('model:\n  llm:\n    id: "x"\n  vision:\n'));
    expect(y.has(['model', 'vision'])).toBe(true);
    expect(y.get(['model', 'vision', 'id'])).toBeUndefined();
  });

  it('hasHarnessYml answers for the directory', () => {
    expect(hasHarnessYml(fromTemplate())).toBe(true);
    expect(hasHarnessYml(mkdtempSync(join(tmpdir(), 'hy-none-')))).toBe(false);
  });
});

describe('harness.yml — editing is byte-exact', () => {
  it('setScalar changes ONLY that line, keeping its trailing comment', () => {
    const dir = fromTemplate();
    const before = read(dir);
    const y = openHarnessYml(dir);
    expect(y.setScalar(['model', 'llm', 'id'], 'other-4b', { quoted: true })).toBe(true);
    y.save();
    const changed = changedLines(before, read(dir));
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('other-4b');
    // The guidance that shared the line is still on it.
    expect(changed[0]).toContain('add `branches:`');
  });

  it('renameKey changes ONLY that line, keeping the value and comment', () => {
    const dir = fromTemplate();
    const before = read(dir);
    const y = openHarnessYml(dir);
    expect(y.renameKey(['model', 'llm', 'id'], 'path')).toBe(true);
    y.save();
    const changed = changedLines(before, read(dir));
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatch(/^\s+path: "qwen3\.5-4b"/);
    expect(changed[0]).toContain('add `branches:`');
  });

  it('setScalar reports false rather than inventing a key', () => {
    const dir = fromTemplate();
    expect(openHarnessYml(dir).setScalar(['model', 'reranker', 'id'], 'x')).toBe(false);
  });

  /**
   * The regression that sent this to the CST. Re-rendering from the Document
   * model emits comments at the indentation of whichever node the parser
   * attached them to, which drags a file's trailing guidance — `# sources:`,
   * `# abilities:` — four spaces deep inside `model.llm`.
   */
  it('never moves a comment: every untouched line is identical, byte for byte', () => {
    const dir = fromTemplate();
    const before = read(dir);
    const y = openHarnessYml(dir);
    y.setScalar(['model', 'llm', 'id'], 'other-4b', { quoted: true });
    y.setScalar(['model', 'llm', 'context'], 4096);
    y.save();
    const after = read(dir);

    expect(changedLines(before, after)).toHaveLength(2);
    // The column-0 guidance is still at column 0, not indented into a block.
    for (const marker of ['# sources:', '# abilities:', '# Local overrides']) {
      expect(after).toContain(`\n${marker}`);
    }
    expect((after.match(/#/g) ?? []).length).toBe((before.match(/#/g) ?? []).length);
  });

  it('save writes nothing when nothing changed', () => {
    const dir = fromTemplate();
    const before = read(dir);
    const y = openHarnessYml(dir);
    expect(y.setScalar(['model', 'nope', 'id'], 'x')).toBe(false);
    y.save();
    expect(read(dir)).toBe(before);
  });
});

describe('harness.yml — inserting', () => {
  it('adds a block at the siblings’ indent, leaving the commented guidance alone', () => {
    const dir = fromTemplate();
    const before = read(dir);
    const y = openHarnessYml(dir);
    y.insert(['model'], ['reranker:', '  id: "qwen3-reranker-0.6b-q8"']);
    y.save();
    const after = read(dir);

    expect(after).toMatch(/^ {2}reranker:\n {4}id: "qwen3-reranker-0\.6b-q8"/m);
    // The template's commented hint survives untouched beside it.
    expect(after).toContain('#     id: "qwen3-reranker-0.6b-q8"');
    // Nothing that was there before was rewritten — only additions.
    for (const line of before.split('\n')) {
      if (line.trim() !== '') expect(after).toContain(line);
    }
  });

  it('reads back what it inserted', () => {
    const dir = fromTemplate();
    const y = openHarnessYml(dir);
    y.insert(['model'], ['reranker:', '  id: "r"']);
    y.save();
    expect(openHarnessYml(dir).get(['model', 'reranker', 'id'])).toBe('r');
  });

  it('appends after a SCALAR last child, not onto its line', () => {
    // A block value's range ends past its newline; a scalar's ends before it.
    // Getting that wrong splices onto the end of the previous line.
    const dir = fromText('model:\n  llm:\n    id: "x"\n    context: 1\n');
    const y = openHarnessYml(dir);
    y.insert(['model', 'llm'], ['gpu: cuda']);
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    id: "x"\n    context: 1\n    gpu: cuda\n');
  });

  it('appends after a last child that carries a trailing comment', () => {
    const dir = fromText('model:\n  llm:\n    id: "x"   # the model\n');
    const y = openHarnessYml(dir);
    y.insert(['model', 'llm'], ['gpu: cuda']);
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    id: "x"   # the model\n    gpu: cuda\n');
  });

  it('inserts into an EMPTY block, one level deeper than its key', () => {
    // `vision:` with nothing under it is how a harness says "this service, with
    // the derived model" — so it has to be writable without a sibling to copy.
    const dir = fromText('model:\n  llm:\n    id: "x"\n  vision:\n');
    const y = openHarnessYml(dir);
    y.insert(['model', 'vision'], ['minTokens: 1024']);
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    id: "x"\n  vision:\n    minTokens: 1024\n');
    expect(openHarnessYml(dir).get(['model', 'vision', 'minTokens'])).toBe(1024);
  });

  it('refuses to insert into a block that is not there', () => {
    const dir = fromTemplate();
    expect(() => openHarnessYml(dir).insert(['nope'], ['x: 1'])).toThrow(/no `nope` block/);
  });
});
