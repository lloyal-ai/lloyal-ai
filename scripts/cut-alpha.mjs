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
 * The pure core lives in cut-alpha.lib.mjs and is tested in test/cut-alpha.test.ts.
 *
 * Run locally: node scripts/cut-alpha.mjs --cut 0 [--dry-run]
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseCut, planAlphas, rewritePins } from './cut-alpha.lib.mjs';

const cutIdx = process.argv.indexOf('--cut');
const CUT = parseCut(cutIdx === -1 ? undefined : process.argv[cutIdx + 1]);
const DRY = process.argv.includes('--dry-run');

/** [bump level, fallback base for a package npm has never seen]. A brand-new
 *  package (media, this arc) needs ONE manual first `npm publish` — CI cannot
 *  create a name (interactive 2FA). sdk and agents are MAJORs this arc. */
const DEPS = {
  '@lloyal-labs/lloyal.node': ['minor', '3.1.1'],
  '@lloyal-labs/media': ['minor', '0.1.0'],
  '@lloyal-labs/sdk': ['major', '3.1.0'],
  '@lloyal-labs/lloyal-agents': ['major', '5.5.1'],
  '@lloyal-labs/rig': ['minor', '5.5.0'],
  '@lloyal-labs/dev-tools': ['minor', '0.4.3'],
  'lloyal-ai': ['minor', '1.10.0'],
};

const view = (name) =>
  execSync(`npm view ${name}@latest version`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

const alphas = planAlphas({
  cut: CUT,
  packages: Object.entries(DEPS).map(([name, [level, fallback]]) => ({ name, level, fallback })),
  view,
});
const own = alphas['lloyal-ai'];

console.log(`cut ${CUT}${DRY ? ' (dry run)' : ''}:`);
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
    const changed = rewritePins(pkg, alphas);
    if (changed) console.log(`  ${path}: pins exact`);
    return changed;
  });
}
