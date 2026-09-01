#!/usr/bin/env node
/**
 * Cut this CLI's alpha and pin BOTH templates to the exact alpha set.
 *
 * The bump table below mirrors the one in hdk's scripts/cut-alpha.mjs and
 * lloyal.node's cut — same rule, same registry bases, run in the same
 * sitting, so the computed versions agree without any cross-repo plumbing.
 * If you change a level in one repo, change it in the other.
 *
 * Exact pins are mandatory, not tidy: semver ranges EXCLUDE prereleases
 * (`^5.6.0` never matches `5.6.0-alpha.2`), so a caret would scaffold a
 * project that cannot install. The pinned template inside the published
 * tarball is the durable record of the set.
 *
 * Run locally: node scripts/cut-alpha.mjs --cut 0 [--dry-run]
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const cutIdx = process.argv.indexOf('--cut');
if (cutIdx === -1) throw new Error('required: --cut <N>');
const CUT = Number(process.argv[cutIdx + 1]);
const DRY = process.argv.includes('--dry-run');

/** [bump level, fallback base for a package npm has never seen]. A brand-new
 *  package (media, this arc) needs ONE manual first `npm publish` — CI cannot
 *  create a name (interactive 2FA). */
const DEPS = {
  '@lloyal-labs/lloyal.node': ['minor', '3.1.1'],
  '@lloyal-labs/media': ['minor', '0.1.0'],
  '@lloyal-labs/sdk': ['minor', '3.1.0'],
  '@lloyal-labs/lloyal-agents': ['major', '5.5.1'],
  '@lloyal-labs/rig': ['minor', '5.5.0'],
  '@lloyal-labs/dev-tools': ['minor', '0.4.3'],
};

const bump = (v, level) => {
  const [maj, min] = v.split('.').map(Number);
  return level === 'major' ? `${maj + 1}.0.0` : `${maj}.${min + 1}.0`;
};
const latest = (name, fallback) => {
  try {
    return execSync(`npm view ${name}@latest version`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    console.log(`  (${name} not on the registry yet — base ${fallback})`);
    return fallback;
  }
};

const alphas = Object.fromEntries(
  Object.entries(DEPS).map(([n, [level, fb]]) => [n, `${bump(latest(n, fb), level)}-alpha.${CUT}`]),
);
const own = `${bump(latest('lloyal-ai', '1.10.0'), 'minor')}-alpha.${CUT}`;

console.log(`cut ${CUT}${DRY ? ' (dry run)' : ''}:`);
console.log(`  lloyal-ai -> ${own}`);
for (const [n, v] of Object.entries(alphas)) console.log(`  ${n} -> ${v}`);

const rewrite = (path, fn) => {
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  if (fn(pkg) && !DRY) writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
};

rewrite('package.json', (pkg) => {
  console.log(`  package.json: version ${pkg.version} -> ${own}`);
  pkg.version = own;
  return true;
});
for (const tpl of ['templates/research', 'templates/basic']) {
  const path = `${tpl}/package.json`;
  if (!existsSync(path)) continue;
  rewrite(path, (pkg) => {
    let changed = false;
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (alphas[dep] && pkg.dependencies[dep] !== alphas[dep]) {
        console.log(`  ${path}: ${dep} ${pkg.dependencies[dep]} -> ${alphas[dep]} (exact)`);
        pkg.dependencies[dep] = alphas[dep];
        changed = true;
      }
    }
    return changed;
  });
}
