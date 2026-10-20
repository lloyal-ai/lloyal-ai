/**
 * The ability spec, `<publisher>/<name>[@<semver>]`, read in one place: the installer parses what the user typed,
 * and the marker writer reads what a project recorded, through this one rule, so the two cannot disagree on
 * where a name ends.
 */

/**
 * Spec grammar: `<publisher>/<name>[@<semver>]` (post-W) or back-compat
 * `<name>[@<semver>]` (lloyal-internal pre-W entries, which never reached
 * external publish). Both segments of the scoped form match the ability/handle
 * grammar `[a-z][a-z0-9_-]{1,63}`.
 */
export const SCOPED_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,63}\/[a-z][a-z0-9_-]{1,63}$/;
export const UNSCOPED_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

export interface AppSpec {
  /** Catalog identifier — `<publisher>/<name>` (or a bare pre-W `<name>`). */
  name: string;
  /** Optional semver range; `undefined` selects the highest published version. */
  semver: string | undefined;
}

export class InvalidAppSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAppSpecError';
  }
}

/**
 * Parse + validate `<publisher>/<name>[@<semver>]`. Scoped names contain `/`
 * but never `@`, so the first `@` (if any) is unambiguously the semver
 * delimiter. Throws {@link InvalidAppSpecError} on a malformed name.
 */
export function parseAbilitySpec(spec: string): AppSpec {
  const atIdx = spec.indexOf('@');
  const name = atIdx === -1 ? spec : spec.slice(0, atIdx);
  const semver = atIdx === -1 ? undefined : spec.slice(atIdx + 1);
  if (!SCOPED_NAME_PATTERN.test(name) && !UNSCOPED_NAME_PATTERN.test(name)) {
    throw new InvalidAppSpecError(
      `invalid ability name "${name}" — expected \`<publisher>/<short-name>\` ` +
        '(e.g., `lloyal/web`, `acme/jira`).',
    );
  }
  return { name, semver };
}
