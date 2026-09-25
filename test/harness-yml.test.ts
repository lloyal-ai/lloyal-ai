import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openHarnessYml, hasHarnessYml, harnessYmlPath } from '../src/scaffold/harness-yml.js';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

const created: string[] = [];
afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

/** A temp dir holding a template's manifest. */
function fromTemplate(name: 'basic' | 'research' = 'basic'): string {
  const dir = mkdtempSync(join(tmpdir(), 'hy-'));
  created.push(dir);
  cpSync(join(TEMPLATES, name, 'harness.yml'), harnessYmlPath(dir));
  return dir;
}

/** A temp dir holding the given manifest text. */
function fromText(yml: string): string {
  const dir = empty();
  writeFileSync(harnessYmlPath(dir), yml);
  return dir;
}

/** A temp dir holding nothing — registered for cleanup like every other. */
function empty(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hy-'));
  created.push(dir);
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
  // a block map. The other spellings are the same document.
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
    const y = openHarnessYml(fromText('model:\n  llm:\n    id: x\n  # reranker:\n  #   id: r\n'));
    expect(y.has(['model', 'llm'])).toBe(true);
    expect(y.has(['model', 'reranker'])).toBe(false);
  });

  it('an EMPTY block is present — absence has to mean declined, not unconfigured', () => {
    const y = openHarnessYml(fromText('model:\n  llm:\n    id: x\n  vision:\n'));
    expect(y.has(['model', 'vision'])).toBe(true);
    expect(y.get(['model', 'vision', 'id'])).toBeUndefined();
  });

  it('hasHarnessYml answers for the directory', () => {
    expect(hasHarnessYml(fromTemplate())).toBe(true);
    expect(hasHarnessYml(empty())).toBe(false);
  });

  it('refuses a manifest that does not parse, naming the file', () => {
    const dir = fromText('model:\n  llm: {\n');
    expect(() => openHarnessYml(dir)).toThrow(/harness\.yml/);
  });
});

describe('harness.yml — the templates are in the library’s own format', () => {
  // A scaffold always writes the chosen model, so the whole file is rendered on
  // the first run. Authored in the canonical form, that render changes only
  // the line it was asked to.
  for (const name of ['basic', 'research'] as const) {
    it(`${name}: setting the model changes exactly one line`, () => {
      const dir = fromTemplate(name);
      const before = read(dir);
      const y = openHarnessYml(dir);
      y.set(['model', 'llm', 'id'], 'other-4b');
      y.save();
      const changed = changedLines(before, read(dir));
      expect(changed).toEqual(['    id: other-4b']);
    });
  }

  it('save writes nothing when nothing changed — a hand-formatted file is left alone', () => {
    const dir = fromText('targets:   [ cli,   web ]\nmodel:\n  llm:\n    id:    "x"   # mine\n');
    const before = read(dir);
    openHarnessYml(dir).save();
    expect(read(dir)).toBe(before);
  });
});

describe('harness.yml — set', () => {
  it('updates an existing scalar in place, keeping its trailing comment', () => {
    const dir = fromText('model:\n  llm:\n    id: "x"   # trunk\n    context: 1\n');
    const y = openHarnessYml(dir);
    y.set(['model', 'llm', 'id'], 'y');
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    id: "y" # trunk\n    context: 1\n');
  });

  it('adds a key to a block map', () => {
    const dir = fromText('model:\n  llm:\n    id: x\n    context: 1\n');
    const y = openHarnessYml(dir);
    y.set(['model', 'llm', 'gpu'], 'cuda');
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    id: x\n    context: 1\n    gpu: cuda\n');
  });

  it('adds a key to a FLOW map, staying on its line', () => {
    const dir = fromText('model:\n  llm: {context: 32768}\n');
    const y = openHarnessYml(dir);
    y.set(['model', 'llm', 'id'], 'qwen');
    y.save();
    expect(read(dir)).toBe('model:\n  llm: {context: 32768, id: qwen}\n');
    expect(openHarnessYml(dir).get(['model', 'llm', 'id'])).toBe('qwen');
  });

  it('adds a key to an EMPTY flow map', () => {
    const dir = fromText('model:\n  llm: {}\n');
    const y = openHarnessYml(dir);
    y.set(['model', 'llm', 'id'], 'qwen');
    y.save();
    expect(read(dir)).toBe('model:\n  llm: {id: qwen}\n');
  });

  it('creates the blocks on the way to a new nested key', () => {
    const dir = fromText('model:\n  llm:\n    id: x\n');
    const y = openHarnessYml(dir);
    y.set(['model', 'reranker', 'id'], 'r');
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    id: x\n  reranker:\n    id: r\n');
  });

  it('writes under an EMPTY block — how a harness requests a service with the derived model', () => {
    const dir = fromText('model:\n  llm:\n    id: x\n  vision:\n');
    const y = openHarnessYml(dir);
    y.set(['model', 'vision', 'minTokens'], 1024);
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    id: x\n  vision:\n    minTokens: 1024\n');
    expect(openHarnessYml(dir).get(['model', 'vision', 'minTokens'])).toBe(1024);
  });

  it('a file with no final newline', () => {
    const dir = fromText('model:\n  llm:\n    id: x\n    context: 32768');
    const y = openHarnessYml(dir);
    y.set(['model', 'llm', 'gpu'], 'cuda');
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    id: x\n    context: 32768\n    gpu: cuda\n');
  });

  it('quotes what needs quoting, and only that — the library’s call, not this module’s', () => {
    const dir = fromText('model:\n  llm:\n    id: x\n');
    const y = openHarnessYml(dir);
    const values: Record<string, string> = {
      plain: './models/llm/x.gguf',
      windows: 'C:\\models\\my "best".gguf',
      numeric: '1e5',
      hash: '#x',
      colon: 'a: b',
    };
    for (const [k, v] of Object.entries(values)) y.set(['model', 'llm', k], v);
    y.save();
    const back = openHarnessYml(dir);
    for (const [k, v] of Object.entries(values)) expect(back.get(['model', 'llm', k])).toBe(v);
    expect(read(dir)).toContain('plain: ./models/llm/x.gguf');
  });

  it('a list is written in flow style', () => {
    const dir = fromText('targets: [cli, desktop, web]\nmodel:\n  llm:\n    id: x\n');
    const y = openHarnessYml(dir);
    y.set(['targets'], ['cli', 'web']);
    y.save();
    expect(read(dir)).toBe('targets: [cli, web]\nmodel:\n  llm:\n    id: x\n');
  });

  it('refuses a scalar where a block is needed, naming where', () => {
    const y = openHarnessYml(fromText('model:\n  llm: oops\n'));
    expect(() => y.set(['model', 'llm', 'id'], 'x')).toThrow(/llm/);
  });
});

describe('harness.yml — a list an alias refers to', () => {
  it('keeps its node on set, so the anchor stays and the alias still resolves — to the new list', () => {
    const dir = fromText('targets: &surfaces [cli, desktop, web]\napp:\n  surfaces: *surfaces\n');
    const yml = openHarnessYml(dir);
    yml.set(['targets'], ['cli']);
    yml.save();
    expect(read(dir)).toBe('targets: &surfaces [cli]\napp:\n  surfaces: *surfaces\n');
    expect(openHarnessYml(dir).get(['app', 'surfaces'])).toEqual(['cli']);
  });

  it('prepare() renders now and writes only when called', () => {
    const dir = fromText('targets: [cli, desktop, web]\n');
    const yml = openHarnessYml(dir);
    yml.set(['targets'], ['cli']);
    const write = yml.prepare();
    expect(read(dir)).toBe('targets: [cli, desktop, web]\n');
    write();
    expect(read(dir)).toBe('targets: [cli]\n');
  });
});

describe('harness.yml — remove and rename', () => {
  it('removes from a block map and from a flow map', () => {
    const block = fromText('model:\n  llm:\n    id: x\n    path: p\n');
    let y = openHarnessYml(block);
    expect(y.remove(['model', 'llm', 'path'])).toBe(true);
    y.save();
    expect(read(block)).toBe('model:\n  llm:\n    id: x\n');

    const flow = fromText('model:\n  llm: {id: x, path: p}\n');
    y = openHarnessYml(flow);
    expect(y.remove(['model', 'llm', 'path'])).toBe(true);
    y.save();
    expect(read(flow)).toBe('model:\n  llm: {id: x}\n');
  });

  it('remove reports false for a missing key or a missing block, and changes nothing', () => {
    const dir = fromText('model:\n  llm:\n    id: x\n');
    const y = openHarnessYml(dir);
    expect(y.remove(['model', 'llm', 'nope'])).toBe(false);
    expect(y.remove(['model', 'reranker', 'id'])).toBe(false);
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    id: x\n');
  });

  it('renameKey keeps the entry where it sits, with its value and comment', () => {
    const dir = fromText('model:\n  llm:\n    id: "x"   # trunk\n    context: 1\n');
    const y = openHarnessYml(dir);
    y.renameKey(['model', 'llm', 'id'], 'path');
    y.save();
    expect(read(dir)).toBe('model:\n  llm:\n    path: "x" # trunk\n    context: 1\n');
  });

  it('renameKey refuses to create a duplicate, and refuses a key that is not there', () => {
    const y = openHarnessYml(fromText('model:\n  llm:\n    id: x\n    path: p\n'));
    expect(() => y.renameKey(['model', 'llm', 'id'], 'path')).toThrow(/already exists/);
    expect(() => y.renameKey(['model', 'llm', 'nope'], 'other')).toThrow(/to rename/);
  });
});

describe('harness.yml — a user’s own comments', () => {
  it('keep their text across a write', () => {
    const dir = fromText(
      '# my manifest\ntargets: [cli]\nmodel:\n  llm:\n    id: x   # the trunk\n    # gpu: cuda\n# tail note\n',
    );
    const y = openHarnessYml(dir);
    y.set(['model', 'llm', 'gpu'], 'cuda');
    y.save();
    const after = read(dir);
    for (const note of ['# my manifest', '# the trunk', '# gpu: cuda', '# tail note']) {
      expect(after).toContain(note);
    }
    expect(openHarnessYml(dir).get(['model', 'llm', 'gpu'])).toBe('cuda');
  });
});
