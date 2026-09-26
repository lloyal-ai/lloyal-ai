/**
 * The `harnessdev` provenance marker in a scaffolded project's `package.json`.
 *
 * `{ template, targets, abilities }` records the facts nothing else in the project
 * carries: which template's target subtree `targets:add` should copy back, which
 * surfaces are present, and the `lloyal install` specs of the AgentApps the
 * template's `harness/harness.ts` imports. The filesystem `targets/<t>/` dirs
 * stay the runtime truth; this marker is the declared record, stamped by `new`
 * and kept in sync by the `targets:` verbs (they already rewrite `package.json`).
 * `abilities` is what `bin/run.js` names back to the user when an ability is missing at
 * boot — the vendored `file:` deps are the install truth. npm ignores the extra
 * top-level key.
 */
import { join } from 'node:path';
import { readPackageJson, writeJson } from './package-json.js';
import type { Target } from './prune-targets.js';

export interface ProjectMarker {
  /** Template this project was scaffolded from (`basic` | `research`). */
  template: string;
  /** Run surfaces present, kept in sync by `targets:add`/`targets:remove`. */
  targets: Target[];
  /**
   * `lloyal install` specs of the AgentApps this harness imports (e.g.
   * `lloyal/web@1.3.0`). Empty on a pre-`abilities` marker — treated as "unknown",
   * never as "none", so nothing infers that a harness needs no abilities.
   */
  abilities: string[];
}

/** Stamp `harnessdev: { template, targets, abilities }` into `<projectDir>/package.json`. */
export function writeProjectMarker(projectDir: string, marker: ProjectMarker): void {
  const pkg = readPkg(projectDir);
  pkg.harnessdev = {
    template: marker.template,
    targets: marker.targets,
    abilities: marker.abilities,
  };
  writePkg(projectDir, pkg);
}

/** Read the marker, or `null` if absent/malformed (pre-marker / hand-made project). */
export function readProjectMarker(projectDir: string): ProjectMarker | null {
  let pkg: PkgWithMarker;
  try {
    pkg = readPkg(projectDir);
  } catch {
    return null;
  }
  const m = pkg.harnessdev;
  if (!m || typeof m.template !== 'string' || !Array.isArray(m.targets)) return null;
  // `abilities` post-dates `{ template, targets }`; a marker without it is still a
  // valid marker (that is the one fact `targets:add` needs), so degrade to [].
  const abilities = Array.isArray(m.abilities) ? m.abilities.filter((a): a is string => typeof a === 'string') : [];
  return { template: m.template, targets: m.targets as Target[], abilities };
}

/**
 * Rewrite just `harnessdev.targets` (after a `targets:` verb changes the set),
 * preserving the recorded `template`. A NO-OP when no marker exists — we never
 * fabricate a `template` (that is the one fact `targets:add` relies on; a guess
 * would later copy surfaces from the wrong template). `targets:add` requires the
 * marker up front, so only `targets:remove` on a pre-marker project hits this.
 */
export function setMarkerTargets(projectDir: string, targets: Target[]): void {
  const pkg = readPkg(projectDir);
  if (!pkg.harnessdev || typeof pkg.harnessdev.template !== 'string') return;
  // `abilities` is orthogonal to the surface set — carry it through untouched rather
  // than dropping it, or a `targets:` verb would silently erase the boot hint.
  const { template, abilities } = pkg.harnessdev;
  pkg.harnessdev = { template, targets, ...(Array.isArray(abilities) ? { abilities } : {}) };
  writePkg(projectDir, pkg);
}

interface PkgWithMarker {
  harnessdev?: { template?: unknown; targets?: unknown; abilities?: unknown };
  [k: string]: unknown;
}

function readPkg(projectDir: string): PkgWithMarker {
  return readPackageJson(join(projectDir, 'package.json')) as PkgWithMarker;
}

function writePkg(projectDir: string, pkg: PkgWithMarker): void {
  writeJson(join(projectDir, 'package.json'), pkg)();
}
