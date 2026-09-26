/**
 * The tsconfig seam: the library owns JSONC. An edit replaces the one array it names and leaves every comment
 * outside it; it is prepared — read and computed — before it lands, so a missing file refuses at prepare time
 * with nothing written; and what it writes parses back to what was asked.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { prepareFilter, prepareMerge, readJsoncArray } from '../src/scaffold/jsonc.js';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'basic');
const created: string[] = [];
afterEach(() => { while (created.length) rmSync(created.pop() as string, { recursive: true, force: true }); });
function tsconfig(name = 'tsconfig.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'jsonc-'));
  created.push(dir);
  cpSync(join(TEMPLATE, name), join(dir, name));
  return join(dir, name);
}
const comments = (text: string): string[] => text.split('\n').filter((l) => l.trim().startsWith('//'));

describe('the tsconfig seam', () => {
  it('reads an array through the parser, comments and all', () => {
    expect(readJsoncArray(tsconfig(), 'exclude')).toContain('targets/desktop');
    expect(readJsoncArray(tsconfig(), 'include')).toEqual(['src/**/*', 'targets/**/*', 'types/**/*']);
    expect(readJsoncArray(tsconfig(), 'nothing')).toEqual([]);
  });

  it('a filter replaces the one array and keeps every comment outside it; the result parses to what was asked', () => {
    const file = tsconfig();
    const before = readFileSync(file, 'utf8');
    const write = prepareFilter(file, 'exclude', (e) => !e.startsWith('targets/web'));
    expect(readFileSync(file, 'utf8')).toBe(before);   // prepared, not landed
    write();
    const after = readFileSync(file, 'utf8');
    expect(comments(after)).toEqual(comments(before));
    expect(parse(after).exclude).toEqual(['src/ui/App.tsx', 'src/ui/Markdown.tsx', 'targets/desktop']);
    expect(parse(after).compilerOptions).toEqual(parse(before).compilerOptions);
  });

  it('a merge adds what is not there and nothing twice; nothing to add leaves the file byte-identical', () => {
    const file = tsconfig();
    prepareMerge(file, 'exclude', ['targets/desktop', 'targets/new/thing.ts'])();
    expect(parse(readFileSync(file, 'utf8')).exclude.filter((e: string) => e === 'targets/desktop')).toHaveLength(1);
    expect(parse(readFileSync(file, 'utf8')).exclude).toContain('targets/new/thing.ts');
    const settled = readFileSync(file, 'utf8');
    prepareMerge(file, 'exclude', ['targets/desktop'])();
    expect(readFileSync(file, 'utf8')).toBe(settled);
  });

  it('a filter can land elsewhere than it read: the template\'s file, filtered, into the project', () => {
    const file = tsconfig('tsconfig.web.json');
    const into = join(dirname(file), 'elsewhere.json');
    prepareFilter(file, 'include', (e) => !e.startsWith('targets/desktop'), into)();
    expect(existsSync(into)).toBe(true);
    expect(parse(readFileSync(into, 'utf8')).include).not.toContain('targets/desktop/view.tsx');
    expect(parse(readFileSync(into, 'utf8')).include).toContain('targets/web/main.tsx');
  });

  it('a file that is not there, or not JSONC, refuses at prepare time — nothing written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jsonc-'));
    created.push(dir);
    expect(() => prepareMerge(join(dir, 'absent.json'), 'include', ['x'])).toThrow(/ENOENT/);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ "include": [ oops');
    expect(() => prepareFilter(bad, 'include', () => true)).toThrow(/not valid JSONC/);
    expect(readFileSync(bad, 'utf8')).toBe('{ "include": [ oops');
  });
});
