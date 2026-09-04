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
