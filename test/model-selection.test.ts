/**
 * What a project selects for a role, as the boot will see it: the local overlay over the manifest, per key;
 * a block present in either file is a request even when it selects nothing; a commented-out block is not
 * there; a version-1 overlay is read at the blocks its keys now live in.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { modelSelection } from '../src/scaffold/model-selection.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'model-selection-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const yml = (text: string) => writeFileSync(join(dir, 'harness.yml'), text);
const json = (v: unknown) => writeFileSync(join(dir, 'harness.json'), JSON.stringify(v));

describe('modelSelection', () => {
  it('reads the manifest: path over id; an empty block is present and selects nothing; a commented-out block is absent', () => {
    yml('model:\n  llm:\n    id: qwen3.5-4b\n  reranker:\n    id: r\n    path: /r.gguf\n');
    expect(modelSelection(dir, 'reranker')).toEqual({ present: true, spec: { path: '/r.gguf' } });
    expect(modelSelection(dir, 'llm')).toEqual({ present: true, spec: { id: 'qwen3.5-4b' } });
    yml('model:\n  llm:\n    id: qwen3.5-4b\n  reranker: {}\n');
    expect(modelSelection(dir, 'reranker')).toEqual({ present: true, spec: null });
    yml('model:\n  llm:\n    id: qwen3.5-4b\n  # reranker:\n  #   id: r\n');
    expect(modelSelection(dir, 'reranker')).toEqual({ present: false, spec: null });
  });

  it('the local overlay outranks the manifest per key, and can request a block the manifest never named', () => {
    yml('model:\n  llm:\n    id: qwen3.5-4b\n  reranker:\n    id: committed\n');
    json({ version: 2, model: { reranker: { id: 'local' } } });
    expect(modelSelection(dir, 'reranker').spec).toEqual({ id: 'local' });
    json({ version: 2, model: { reranker: { path: '/local.gguf' } } });
    expect(modelSelection(dir, 'reranker').spec).toEqual({ path: '/local.gguf' });
    yml('model:\n  llm:\n    id: qwen3.5-4b\n');
    json({ version: 2, model: { reranker: {} } });
    expect(modelSelection(dir, 'reranker')).toEqual({ present: true, spec: null });
  });

  it('a version-1 overlay (before 1.11) is refused by name, as rig refuses it; an unknown version is not read', () => {
    yml('model:\n  llm:\n    id: qwen3.5-4b\n');
    json({ version: 1, model: { rerankerId: 'r1', reranker: '/r1.gguf' } });
    expect(() => modelSelection(dir, 'reranker')).toThrow('harness.json is version 1, written before 1.11 — delete it and relaunch.');
    json({ version: 3, model: { reranker: { id: 'future' } } });
    expect(modelSelection(dir, 'reranker')).toEqual({ present: false, spec: null });
  });

  it('a project with no manifest and no overlay selects nothing', () => {
    expect(modelSelection(dir, 'reranker')).toEqual({ present: false, spec: null });
  });
});
