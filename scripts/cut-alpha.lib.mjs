/**
 * The alpha cutter's pure core — the CLI copy. The script is I/O around it:
 * `npm view`, this package's own version, and the templates' exact pins.
 * Mirrors hdk's scripts/cut-alpha.lib.mjs: same rules, same registry bases,
 * run in the same sitting, so the two sets agree without cross-repo plumbing.
 */

/** The arc's bump table: package → [level, fallback base for a package npm has
 *  never seen]. A brand-new package needs ONE manual first `npm publish` — CI
 *  cannot create a name (interactive 2FA). sdk and agents are MAJORs this arc,
 *  as hdk's own table says. If a level changes in one repo, change the other.
 *
 *  Exported so the golden test reads THIS table rather than a copy of it: a
 *  copy once said sdk was a minor while this said major, and stayed green.
 *  @type {Record<string, ['major' | 'minor', string]>} */
export const DEPS = {
  '@lloyal-labs/lloyal.node': ['minor', '3.1.1'],
  '@lloyal-labs/media': ['minor', '0.1.0'],
  '@lloyal-labs/sdk': ['major', '3.1.0'],
  '@lloyal-labs/lloyal-agents': ['major', '5.5.1'],
  '@lloyal-labs/rig': ['minor', '5.5.0'],
  '@lloyal-labs/dev-tools': ['minor', '0.4.3'],
  'lloyal-ai': ['minor', '1.10.0'],
};

/** The table as `planAlphas` takes it.
 *  @param {Record<string, ['major' | 'minor', string]>} deps
 *  @returns {Array<{ name: string, level: 'major' | 'minor', fallback: string }>} */
export const arcPackages = (deps) =>
  Object.entries(deps).map(([name, [level, fallback]]) => ({ name, level, fallback }));

/** `--cut <N>`: a non-negative integer, nothing else. `Number()` would take
 *  a missing or garbled value as NaN and stamp `-alpha.NaN` everywhere. */
export function parseCut(arg) {
  const n = arg === undefined || !/^\d+$/.test(String(arg)) ? NaN : Number(arg);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`--cut <N> must be a non-negative integer (got ${JSON.stringify(arg ?? null)})`);
  }
  return n;
}

/** A prerelease `latest` is the pending base, never bumped again; a stable
 *  latest bumps by the arc's level. */
export function nextBase(reg, level) {
  if (reg.includes('-')) return reg.split('-')[0];
  const [maj, min] = reg.split('.').map(Number);
  return level === 'major' ? `${maj + 1}.0.0` : `${maj}.${min + 1}.0`;
}

/** Only the registry's own "no such package" earns the local fallback. */
export const isNotFound = (err) =>
  err?.code === 'E404' || /\bE404\b|404 Not Found/.test(`${err?.stderr ?? ''}\n${err?.message ?? ''}`);

export function latestVersion(name, fallback, view) {
  try {
    return String(view(name)).trim();
  } catch (err) {
    if (!isNotFound(err)) throw err;
    console.log(`  (${name} not on the registry yet — base ${fallback})`);
    return fallback;
  }
}

/**
 * `{ name → x.y.z-alpha.<cut> }` for every `{ name, level, fallback }`.
 * @param {{ cut: number,
 *           packages: Array<{ name: string, level: 'major' | 'minor', fallback: string }>,
 *           view: (name: string) => string }} plan
 * @returns {Record<string, string>}
 */
export function planAlphas({ cut, packages, view }) {
  /** @type {Record<string, string>} */
  const alphas = {};
  for (const { name, level, fallback } of packages) {
    alphas[name] = `${nextBase(latestVersion(name, fallback, view), level)}-alpha.${cut}`;
  }
  return alphas;
}

/**
 * The members this cut actually ships.
 *
 * `DEPS` says what the arc TOUCHED; it cannot say what moves on any given cut.
 * Treating it as the set is what stamped an alpha for a binding that was not
 * shipping, pinning manifests to a version that would never exist.
 *
 * A whitelist rather than an exclusion, because the failure modes are not
 * symmetric. Forget to exclude and you stamp a phantom version. Forget to
 * include and the package keeps its published version, which every dependent
 * then pins — an incomplete set where everything still resolves. Omission has
 * to degrade, not break.
 *
 * Throws on a name the table does not contain, and the caller must pass at
 * least one: a cut is a decision, and there is no sensible default for it.
 * Defaulting to the whole table is what stamped a version for a member that
 * shipped nothing, so absence has to mean nothing, never everything.
 */
export function include(alphas, names) {
  if (names.length === 0) {
    throw new Error(`--include <name> is required (one or more of: ${Object.keys(alphas).join(', ')})`);
  }
  const kept = {};
  for (const n of names) {
    if (!(n in alphas)) {
      throw new Error(`--include ${n}: not in the cut (${Object.keys(alphas).join(', ')})`);
    }
    kept[n] = alphas[n];
  }
  return kept;
}

/**
 * Template pins that would move while `lloyal-ai` itself stays put.
 *
 * The templates are not published packages — they ride this package's tarball.
 * So moving a template pin without moving `lloyal-ai` writes a change git
 * records and the registry never sees: the published CLI keeps scaffolding the
 * PREVIOUS set. hdk's closure rule is over its workspace graph; here the graph
 * is one edge, and this is it.
 *
 * Returns `{ template, dep }` for each offending pin, empty when the cut is
 * coherent.
 */
export function unclosed(alphas, templates) {
  if (alphas['lloyal-ai']) return [];
  const gaps = [];
  for (const { path, pkg } of templates) {
    for (const field of ['dependencies', 'devDependencies']) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (alphas[dep]) gaps.push({ template: path, dep });
      }
    }
  }
  return gaps;
}

/** Pin every alpha dependency EXACTLY — semver ranges exclude prereleases, so
 *  a caret would scaffold a project that cannot install. devDependencies
 *  count: the research template keeps @lloyal-labs/media there. Returns
 *  whether anything changed. */
export function rewritePins(pkg, alphas) {
  let changed = false;
  for (const field of ['dependencies', 'devDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (alphas[dep] && pkg[field][dep] !== alphas[dep]) { pkg[field][dep] = alphas[dep]; changed = true; }
    }
  }
  return changed;
}
