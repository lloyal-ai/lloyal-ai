#!/usr/bin/env node
/**
 * Fail fast, naming the command that fixes it, when an Ability this harness
 * imports was never vendored.
 *
 * `src/app.ts` imports its abilities at the top level, so a scaffold made
 * with `--skip-abilities` — or one whose fetch failed — cannot typecheck. Without
 * this guard `npm start` dies inside `tsc` with a bare TS2307: the compiler
 * complaining about a supply problem. Running ahead of the compiler puts the
 * `lloyal install` line in front of the user instead.
 *
 * Both truth sources are in package.json, and the CLI writes both:
 *
 *   harnessdev.abilities        the install specs `lloyal new` recorded
 *   dependencies[<name>]   `file:vendor/<publisher>__<name>-<version>.tgz`,
 *                          written by the CLI when it vendors an ability
 *
 * A spec is satisfied when some dependency points at its vendored tarball. That
 * `vendor/<flat>-<version>.tgz` shape is the ONE thing this script assumes about
 * the CLI. If the CLI ever names its vendored tarballs differently, this has to follow.
 *
 * Deliberately narrow: this checks only that the abilities were VENDORED. "Vendored
 * but never npm-installed" is left to `bin/run.js`, which sees the real
 * resolution failure and so cannot guess wrong about it.
 */
import { readFileSync, readdirSync, lstatSync } from "node:fs";

const pkg = readPkg();
const specs = recordedSpecs(pkg);

// An absent or empty `abilities` marker means UNKNOWN, never "none". Blocking here would break any project
// that predates the marker or was written by hand.
if (specs.length === 0) process.exit(0);

// A workspace checkout (`lloyal link-local`) gets its Abilities from the workspace:
// they are SYMLINKED into node_modules, never vendored. The rule below asks only
// whether a tarball was vendored, so without this it fails a project that boots
// perfectly well — and that is the documented in-place development path. A
// generated app has no symlink here, so nothing is loosened for a real user; an
// Ability that is linked but absent still fails, in `bin/run.js`, where the real
// resolution error can be named.
if (linkedWorkspace()) process.exit(0);

const vendored = new Set(
  Object.values(pkg.dependencies ?? {}).filter(
    (v) => typeof v === "string" && v.startsWith("file:vendor/"),
  ),
);

const missing = specs.filter((spec) => {
  const want = expectedVendorDep(spec);
  return want !== null && !vendored.has(want);
});

if (missing.length) {
  const plural = missing.length > 1;
  process.stderr.write(
    `\nThis harness imports ${plural ? "Abilities that are" : "an Ability that is"} not installed.\n` +
      "Fetch the signed (Ed25519-verified) bundles, then try again:\n\n" +
      `${missing.map((spec) => `  npx lloyal-ai install ${spec}`).join("\n")}\n\n`,
  );
  process.exit(1);
}

/** True when the platform packages are symlinked in rather than installed. */
function linkedWorkspace() {
  try {
    const dir = new URL("../node_modules/@lloyal-labs/", import.meta.url);
    return readdirSync(dir).some((entry) => lstatSync(new URL(entry, dir)).isSymbolicLink());
  } catch {
    return false; // no node_modules yet — nothing is linked, so the rule applies
  }
}

/** The `lloyal install` specs `lloyal new` recorded for this project. */
function recordedSpecs(pkg) {
  const abilities = pkg.harnessdev?.abilities;
  return Array.isArray(abilities) ? abilities.filter((a) => typeof a === "string") : [];
}

/** `lloyal/web@1.3.0` → `file:vendor/lloyal__web-1.3.0.tgz`. */
function expectedVendorDep(spec) {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return null; // unpinned or unparseable — never call it missing
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (!name.includes("/") || !version) return null;
  return `file:vendor/${name.replace("/", "__")}-${version}.tgz`;
}

function readPkg() {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
}
