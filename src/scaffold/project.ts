/**
 * Shared guard for the in-project commands (`models:` + `targets:`): they mutate
 * the CURRENT harness project, so they must be run from its root.
 */
import { hasHarnessYml, HARNESS_YML } from './harness-yml.js';

/**
 * The cwd, verified to be a harness project (a `harness.yml` sits here). Throws
 * a friendly error otherwise — the caller prints it and exits non-zero.
 */
export function harnessProjectRoot(): string {
  const cwd = process.cwd();
  if (!hasHarnessYml(cwd)) {
    throw new Error(
      `not a harness project — no ${HARNESS_YML} in the current directory. Run this ` +
        'from your harness project root (where `lloyal new` scaffolded it).',
    );
  }
  return cwd;
}
