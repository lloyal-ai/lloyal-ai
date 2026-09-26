/**
 * The release driver's pure core. The script is I/O around it: reading
 * manifests off the remote, dispatching workflows, watching runs.
 *
 * Replaces what `alpha-cut.yml` did, for cuts that cannot use hosted runners.
 * That workflow dispatches lloyal.node unconditionally with no way to skip it,
 * and its own orchestrating job needs a hosted runner too — so when hosted
 * minutes are the problem, it cannot be the answer.
 */

/**
 * The repos this release walks, IN ORDER, with the manifests whose versions
 * decide the dist-tag.
 *
 * The order is a property of this table rather than of whoever typed the
 * command: media, sdk, agents and rig must be on the registry before the CLI
 * publishes templates that pin them, or a scaffold resolves versions that do
 * not exist yet. Exported so the test reads THIS table and not a copy of it —
 * the cutter carries a scar from exactly that, where a copy said one thing and
 * the real table another, and both stayed green.
 */
export const TARGETS = [
  {
    repo: 'lloyal-ai/hdk',
    branch: 'feat/mtmd',
    manifests: [
      'packages/media/package.json',
      'packages/sdk/package.json',
      'packages/agents/package.json',
      'packages/rig/package.json',
      'packages/dev-tools/package.json',
    ],
  },
  {
    repo: 'lloyal-ai/lloyal-ai',
    branch: 'feat/research-identity',
    manifests: ['package.json'],
  },
];

/**
 * The dist-tag a version publishes under.
 *
 * Deliberately the same rule as the `case` statement in both release
 * workflows: anything without a prerelease suffix falls through to `latest`.
 * Mirrored here so this pre-flight and that gate cannot disagree about what
 * would happen.
 */
export function distTag(version) {
  if (/-alpha/.test(version)) return 'alpha';
  if (/-beta/.test(version)) return 'beta';
  if (/-rc/.test(version)) return 'rc';
  return 'latest';
}

/**
 * Manifests that would publish to `latest`.
 *
 * A manual dispatch may only ever ship a prerelease. The workflow refuses this
 * too and that gate is the authority; this one runs first so the refusal costs
 * a second rather than a container, a registration and a build.
 */
export function wouldMoveLatest(entries) {
  return entries.filter((e) => distTag(e.version) === 'latest');
}

/**
 * `--target repo:branch`, repeatable. Absent, the table above is the release.
 *
 * Unlike the cutter's `--include`, a default here is safe: naming no target
 * dispatches the standard set in the standard order, which is the whole point
 * of the table. Naming a bad one must still fail rather than be ignored.
 */
export function parseTargets(argv, defaults = TARGETS) {
  const named = argv.flatMap((a, i) => (a === '--target' ? [argv[i + 1]] : []));
  if (named.length === 0) return defaults;
  return named.map((spec) => {
    // The FIRST colon separates them. git refnames cannot contain a colon, so
    // a second one is a malformed spec rather than a branch with a colon in it.
    const at = String(spec ?? '').indexOf(':');
    const repo = at === -1 ? '' : spec.slice(0, at);
    const branch = at === -1 ? '' : spec.slice(at + 1);
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
      throw new Error(`--target ${spec}: expected <owner>/<repo>:<branch>`);
    }
    const known = defaults.find((t) => t.repo === repo);
    if (!known) {
      throw new Error(`--target ${spec}: ${repo} is not a release target (${defaults.map((t) => t.repo).join(', ')})`);
    }
    return { ...known, branch };
  });
}
