#!/usr/bin/env node
/**
 * Dispatch the release workflows for a cut, in dependency order, against a
 * local self-hosted runner.
 *
 *   node scripts/release-set.mjs                                   # the standard set
 *   node scripts/release-set.mjs --dry-run                         # pre-flight only
 *   node scripts/release-set.mjs --target lloyal-ai/hdk:feat/mtmd  # override, repeatable
 *
 * Start the runner first — see lloyal-infra/release-runner. Each repo needs
 * its own registration; the container takes one job and exits, so start one
 * per target as the chain reaches it.
 *
 * The pure core (the target table, the dist-tag rule, the argument parsing)
 * lives in release-set.lib.mjs and is tested there.
 */
import { execFileSync } from 'node:child_process';
import { TARGETS, parseTargets, wouldMoveLatest, distTag } from './release-set.lib.mjs';

const DRY = process.argv.includes('--dry-run');
const targets = parseTargets(process.argv);

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

/** A manifest's version as it stands ON THE REMOTE BRANCH — not on disk. What
 *  the runner checks out is what publishes, and the two can differ. */
const versionAt = (repo, branch, path) => {
  const b64 = gh(['api', `repos/${repo}/contents/${path}?ref=${branch}`, '--jq', '.content']);
  return JSON.parse(Buffer.from(b64.replace(/\s/g, ''), 'base64').toString('utf8')).version;
};

for (const { repo, branch, manifests } of targets) {
  console.log(`\n=== ${repo} @ ${branch} ===`);
  const entries = manifests.map((path) => ({ path, version: versionAt(repo, branch, path) }));
  for (const e of entries) console.log(`  ${e.path.padEnd(34)} ${e.version}  -> ${distTag(e.version)}`);

  const bad = wouldMoveLatest(entries);
  if (bad.length > 0) {
    const lines = bad.map((e) => `  ${e.path} is ${e.version}`);
    throw new Error(
      `${repo}@${branch} would publish to latest:\n${lines.join('\n')}\n`
      + 'A manual dispatch may only ship a prerelease; production goes through a v* tag.',
    );
  }

  if (DRY) { console.log('  dry run - not dispatched'); continue; }

  gh(['workflow', 'run', 'release.yml', '-R', repo, '--ref', branch,
      '-f', 'skip_publish=false', '-f', 'runner=self-hosted']);
  // The dispatch is asynchronous; give the run a moment to exist before asking
  // which one it is, or `gh run list` answers with the PREVIOUS run.
  execFileSync('sleep', ['15']);
  const id = gh(['run', 'list', '-R', repo, '--workflow=release.yml',
                 '--branch', branch, '--limit', '1', '--json', 'databaseId',
                 '-q', '.[0].databaseId']).trim();
  console.log(`  watching run ${id}`);
  // --exit-status stops the chain here rather than starting the next repo
  // against packages that never published.
  execFileSync('gh', ['run', 'watch', id, '-R', repo, '--exit-status', '--interval', '30'],
               { stdio: 'inherit' });
}

console.log(`\n${DRY ? 'pre-flight passed' : 'released'}: ${targets.map((t) => t.repo).join(' -> ')}`);
