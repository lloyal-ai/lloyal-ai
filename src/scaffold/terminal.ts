/**
 * Whether there is somebody to ask: stdin is a TTY, and so is the stream the question is drawn on. A pipe, CI,
 * or a redirected stream on either side has nobody, so a verb that would ask takes its non-interactive path.
 * The picker draws on stdout; an offer to write `harness.yml` draws on stderr, so stdout can stay a clean
 * pipe — each asks about the stream it uses. The ONE derivation; every verb reads it here.
 */
export const interactive = (drawnOn: NodeJS.WriteStream = process.stdout): boolean =>
  Boolean(process.stdin.isTTY) && Boolean(drawnOn.isTTY);
