/**
 * Whether there is somebody to ask: both ends of the terminal are a TTY. A pipe, CI, or a redirected stream on
 * either side has nobody, so a verb that would ask — a picker, an offer to write `harness.yml` — takes its
 * non-interactive path. The ONE derivation; every verb reads it here.
 */
export const interactive = (): boolean => Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
