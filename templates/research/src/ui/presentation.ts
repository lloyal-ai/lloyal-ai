/** What this app is called, said once, and the one sentence every view says in its own place. Every surface reads
 *  them from here: the sidebar, the browser tab, the desktop window, the terminal header, the served host and the
 *  dev pane.
 *
 *  `name` is for people: change it whenever you like. `storage` prefixes what a browser remembers for a reader
 *  (the open panel, this machine's pace), so it is kept apart: renaming the app does not forget any of that,
 *  and changing `storage` does. Node-free, so every target can import it. */
export const APP = {
  name: "__NAME__",
  storage: "__NAME__",
} as const;

/** Said where an answer would be, for a brief or a follow-up that ran to its end and found nothing: no report was
 *  written, nothing was invented. */
export const NOTHING_KEPT = "The sources turned up nothing to settle this on — nothing was kept.";
