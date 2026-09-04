/**
 * Shared scaffolding primitives: locate a template directory and copy a tree
 * with `__TOKEN__` substitutions. Used by `new` (copies a whole template) and
 * by `targets:add` (copies one target subtree back from the originating
 * template). Kept here — not in a command module — so both share one copier and
 * one token set (`__NAME__` today).
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync, copyFileSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve a template directory by walking up from this compiled module. After
 * build the CLI lives at `<pkg>/dist/scaffold/copy-tree.js`, so the templates
 * are at `<pkg>/templates/<kind>`; a second candidate covers a flatter layout.
 */
export function resolveTemplateDir(kind: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', 'templates', kind),
    resolve(here, '..', 'templates', kind),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isDirectory()) return c;
    } catch {
      // try next
    }
  }
  throw new Error(`templates/${kind} not found relative to ${here}`);
}

/** The `__TOKEN__` → value map applied to every copied file + filename. */
export function buildSubstitutions(name: string): Record<string, string> {
  return {
    __NAME__: name,
  };
}

/**
 * Template filenames that must land in the scaffold as dotfiles.
 *
 * npm silently drops a nested `.gitignore` from the published tarball — even
 * when it is named explicitly in `files` — so a template that stores one under
 * its real name ships it to anyone running from a git checkout and to NOBODY
 * running `npx lloyal`. Store it undotted in the template and restore the
 * dot here, so the published CLI and the repo emit the same tree.
 */
const DOTFILES: Record<string, string> = {
  gitignore: '.gitignore',
};

/**
 * Never part of a template, whatever the directory holds. A checkout whose
 * template has been `link-local`ed carries a `node_modules` of symlinks and
 * binaries; scaffolding it would hand every developer that tree.
 */
const NEVER_COPIED = new Set(['node_modules']);

/** Strict decoder: a file that is not valid UTF-8 is a binary and is copied
 *  byte-for-byte — substitution is for text, and a text round trip turns a
 *  binary's bytes into U+FFFD. */
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Recursively copy `src` → `dest`, applying `substitutions` to paths + text. */
export function copyTreeWithSubstitutions(
  src: string,
  dest: string,
  substitutions: Record<string, string>,
): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const fromPath = join(src, entry.name);
    const toName = DOTFILES[entry.name] ?? applySubstitutions(entry.name, substitutions);
    const toPath = join(dest, toName);

    if (entry.isDirectory()) {
      if (NEVER_COPIED.has(entry.name)) continue;
      copyTreeWithSubstitutions(fromPath, toPath, substitutions);
      continue;
    }
    if (!entry.isFile()) continue;
    copyFileWithSubstitutions(fromPath, toPath, substitutions);
  }
}

/** Copy one file, applying `__TOKEN__` substitutions to its text. A binary is
 *  copied verbatim. Either way the source's mode travels with it, so an
 *  executable stays executable. */
export function copyFileWithSubstitutions(
  src: string,
  dest: string,
  substitutions: Record<string, string>,
): void {
  mkdirSync(dirname(dest), { recursive: true });
  const bytes = readFileSync(src);
  let text: string | null;
  try {
    text = utf8.decode(bytes);
  } catch {
    text = null;
  }
  if (text === null) {
    copyFileSync(src, dest);
  } else {
    writeFileSync(dest, applySubstitutions(text, substitutions), 'utf-8');
  }
  chmodSync(dest, statSync(src).mode & 0o777);
}

function applySubstitutions(s: string, substitutions: Record<string, string>): string {
  let out = s;
  for (const [token, value] of Object.entries(substitutions)) {
    out = out.split(token).join(value);
  }
  return out;
}
