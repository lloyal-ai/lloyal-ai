/**
 * Add a run surface back to a scaffolded project — the exact inverse of
 * `pruneTargets`. It re-materializes what prune removed for a target: the
 * `targets/<t>/` dir + the target's exclusive files, its npm scripts + deps
 * (VERSIONS sourced from the originating template's `package.json`), and its
 * slice of the tsconfig split. The template is read from the `harnessdev.template`
 * marker so a `web` surface added to a `research` project folds research's own
 * views — not basic's.
 *
 * Shares the per-target tables with `prune-targets.ts` (so add-copy ↔
 * prune-delete can't drift), the JSONC array editing with `jsonc.ts`, and the
 * boundary `prune-targets.ts` states: every write prepared before anything is
 * copied, then landed together.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Target,
  type PrunableTarget,
  TARGET_SCRIPTS,
  TARGET_DEPS,
  TARGET_DEV_DEPS,
  TARGET_FILES,
  TARGET_PKG_FIELDS,
  SHARED_RENDERER_DEPS,
  SHARED_RENDERER_DEV_DEPS,
  SHARED_VIEW_DIR,
  openManifest,
  prepareTargetsLine,
} from './prune-targets.js';
import { readPackageJson, writeJson } from './package-json.js';
import type { PackageJson } from './package-json.js';
import {
  resolveTemplateDir,
  copyTreeWithSubstitutions,
  copyFileWithSubstitutions,
  buildSubstitutions,
} from './copy-tree.js';
import { prepareFilter, prepareMerge, readJsoncArray } from './jsonc.js';
import type { Write } from './jsonc.js';

const ALL_TARGETS: Target[] = ['cli', 'desktop', 'web'];

/** The non-cli targets that currently have a scaffolded dir (cli always kept). */
export function presentTargets(projectDir: string): Target[] {
  const present = new Set<Target>(['cli']);
  for (const t of ['desktop', 'web'] as PrunableTarget[]) {
    if (existsSync(join(projectDir, 'targets', t))) present.add(t);
  }
  return ALL_TARGETS.filter((t) => present.has(t));
}

/**
 * Add `target` back to `projectDir`, copying from `template`. Returns the new
 * full target set (for the marker). Throws if the target is already present or
 * the template lacks it.
 */
export function addTarget(projectDir: string, target: PrunableTarget, template: string): Target[] {
  const before = new Set(presentTargets(projectDir));
  if (before.has(target)) {
    throw new Error(`target "${target}" is already present`);
  }
  const templateDir = resolveTemplateDir(template);
  const templateTargetDir = join(templateDir, 'targets', target);
  if (!existsSync(templateTargetDir)) {
    throw new Error(`template "${template}" has no targets/${target}/ to copy`);
  }

  // ── prepare: every input read and checked, every output computed — a manifest that will not render, a
  // package that is not the shape this edits, a tsconfig that is not there, all found with the project untouched ──
  const manifest = openManifest(projectDir);
  const pkgPath = join(projectDir, 'package.json');
  const pkg = readPackageJson(pkgPath);
  const tpl = readPackageJson(join(templateDir, 'package.json'));
  const subs = buildSubstitutions(pkg.name ?? 'harness');
  // Both `web` and `desktop` contribute DOM (React) sources to tsconfig.web.json.
  const domBefore = before.has('web') || before.has('desktop');
  const hasDesktopAfter = target === 'desktop' || before.has('desktop');
  // A template's own view dir, when it has one and a cli-only prune removed it, comes back with the FIRST DOM
  // target, exactly as SHARED_RENDERER_DEPS do — if one is already present the dir is there and must not be
  // overwritten (the user owns that file; it is their view). A template whose view lives beside the fold
  // declares none: nothing was pruned, so there is nothing to restore.
  const viewDir = SHARED_VIEW_DIR[template];
  const after = ALL_TARGETS.filter((t) => before.has(t) || t === target);
  const writes: Write[] = [
    writeJson(pkgPath, restorePackageJson(pkg, tpl, target, { domBefore, hasDesktopAfter })),
    ...prepareTsconfig(projectDir, templateDir, target, template, domBefore),
    prepareTargetsLine(manifest, after),
  ];

  // ── mutate: the target's own dir, its exclusive top-level files, the view dir it brings back ──
  copyTreeWithSubstitutions(templateTargetDir, join(projectDir, 'targets', target), subs);
  for (const rel of TARGET_FILES[target]) {
    const src = join(templateDir, rel);
    if (existsSync(src)) copyFileWithSubstitutions(src, join(projectDir, rel), subs);
  }
  if (!domBefore && viewDir) {
    copyTreeWithSubstitutions(join(templateDir, viewDir), join(projectDir, viewDir), subs);
  }

  // ── land ──
  for (const write of writes) write();
  return after;
}

/** The package with the target's scripts, fields and deps restored from the template — pure over the parsed objects. */
function restorePackageJson(
  pkg: PackageJson,
  tpl: PackageJson,
  target: PrunableTarget,
  flags: { domBefore: boolean; hasDesktopAfter: boolean },
): PackageJson {
  pkg.scripts ??= {};
  pkg.dependencies ??= {};
  pkg.devDependencies ??= {};

  for (const s of TARGET_SCRIPTS[target]) {
    if (tpl.scripts?.[s] != null && pkg.scripts[s] == null) pkg.scripts[s] = tpl.scripts[s];
  }
  // Top-level fields the target owns (desktop's Electron `main` entry point).
  for (const f of TARGET_PKG_FIELDS[target]) {
    if (tpl[f] != null && pkg[f] == null) pkg[f] = tpl[f];
  }
  addFromTemplate(pkg.dependencies, tpl.dependencies, TARGET_DEPS[target]);
  addFromTemplate(pkg.devDependencies, tpl.devDependencies, TARGET_DEV_DEPS[target]);
  // The shared DOM-renderer deps come back only with the FIRST DOM target.
  if (!flags.domBefore) {
    addFromTemplate(pkg.dependencies, tpl.dependencies, SHARED_RENDERER_DEPS);
    addFromTemplate(pkg.devDependencies, tpl.devDependencies, SHARED_RENDERER_DEV_DEPS);
  }
  // Rebuild `typecheck` for the surviving tsconfigs (a DOM target now exists).
  if (pkg.scripts.typecheck != null) {
    const parts = ['tsc --noEmit', 'tsc -p tsconfig.web.json'];
    if (flags.hasDesktopAfter) parts.push('tsc -p tsconfig.electron.json');
    pkg.scripts.typecheck = parts.join(' && ');
  }
  return pkg;
}

/** Copy `keys` from `source` into `target`, add-if-absent (never clobber). */
function addFromTemplate(
  target: Record<string, string>,
  source: Record<string, string> | undefined,
  keys: readonly string[],
): void {
  if (!source) return;
  for (const k of keys) {
    if (source[k] != null && target[k] == null) target[k] = source[k];
  }
}

/** The tsconfig edits the target needs, prepared: each file read and its result computed now. */
function prepareTsconfig(
  projectDir: string,
  templateDir: string,
  target: PrunableTarget,
  template: string,
  domBefore: boolean,
): Write[] {
  const underTarget = (entry: string): boolean => entry.startsWith(`targets/${target}`);
  // A template's view-dir entries belong to whichever DOM target arrives FIRST — they are not under
  // `targets/<target>/`, so `underTarget` alone would leave them out and the Node build would then try to
  // compile the React view.
  const viewDir = SHARED_VIEW_DIR[template];
  const wanted = (entry: string): boolean =>
    underTarget(entry) || (!domBefore && viewDir !== undefined && entry.startsWith(viewDir));
  const writes: Write[] = [];

  // Root tsconfig.json: merge this target's EXCLUDE entries (it always exists; its `include` is a glob that
  // already covers the new dir).
  const rootCfg = join(projectDir, 'tsconfig.json');
  if (existsSync(rootCfg)) {
    writes.push(prepareMerge(rootCfg, 'exclude', readJsoncArray(join(templateDir, 'tsconfig.json'), 'exclude').filter(wanted)));
  }

  // tsconfig.web.json holds the DOM sources (web browser + Electron renderer).
  const webCfg = join(projectDir, 'tsconfig.web.json');
  const templateWebCfg = join(templateDir, 'tsconfig.web.json');
  if (domBefore) {
    // A DOM target already present → merge this target's include entries into the project's own file — which
    // must be there: a DOM target without it is a project this verb cannot finish, said here.
    writes.push(prepareMerge(webCfg, 'include', readJsoncArray(templateWebCfg, 'include').filter(underTarget)));
  } else {
    // cli-only → prune deleted tsconfig.web.json; the template's, with the non-target entries + THIS target's
    // + the view dir (dropping only the other DOM target's), is what the project gets. Without the `wanted`
    // widening a view-dir entry is silently dropped and typecheck stops covering the file both surviving
    // targets mount.
    writes.push(prepareFilter(templateWebCfg, 'include', (entry) => !entry.startsWith('targets/') || wanted(entry), webCfg));
  }
  return writes;
}

