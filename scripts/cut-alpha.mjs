#!/usr/bin/env node
/**
 * Cut this CLI's alpha and pin BOTH templates to the exact alpha set.
 *
 * The bump table (DEPS, in cut-alpha.lib.mjs) mirrors hdk's — same rule,
 * same registry bases, run in the same sitting, so the computed versions
 * agree without any cross-repo plumbing.
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
import { DEPS, arcPackages, parseCut, planAlphas, rewritePins } from './cut-alpha.lib.mjs';

const cutIdx = process.argv.indexOf('--cut');
const CUT = parseCut(cutIdx === -1 ? undefined : process.argv[cutIdx + 1]);
const DRY = process.argv.includes('--dry-run');

const view = (name) =>
  execSync(`npm view ${name}@latest version`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

const alphas = planAlphas({ cut: CUT, packages: arcPackages(DEPS), view });
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
