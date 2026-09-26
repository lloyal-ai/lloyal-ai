/**
 * A project's `package.json`, read for the shape the scaffold verbs edit and written whole. Read before any
 * mutation, like the manifest: `JSON.parse` accepts `null`, an array, a number, and a `scripts` that is a string
 * would only fail when the first key is written into it — after a target's files were already gone.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Write } from './jsonc.js';

export interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [k: string]: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The file parsed and checked: an object at the root, and each dependency section absent or an object. */
export function readPackageJson(file: string): PackageJson {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isPlainObject(parsed)) throw new Error(`${file}: expected an object at the top level`);
  for (const field of ['scripts', 'dependencies', 'devDependencies'] as const) {
    if (parsed[field] !== undefined && !isPlainObject(parsed[field])) throw new Error(`${file}: "${field}" must be an object`);
  }
  return parsed as PackageJson;
}

/** A JSON file's write, its text computed now. */
export function writeJson(file: string, value: unknown): Write {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return () => writeFileSync(file, text);
}
