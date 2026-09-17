/** What this app is called, said once. Every surface reads it from here: the sidebar, the browser tab, the
 *  desktop window, the terminal header, the served host and the dev pane.
 *
 *  `name` is for people: change it whenever you like. `storage` prefixes what a browser remembers for a reader
 *  (the open panel, this machine's pace), so it is kept apart: renaming the app does not forget any of that,
 *  and changing `storage` does. Node-free, so every target can import it. */
export const APP = {
  name: "__NAME__",
  storage: "__NAME__",
} as const;
