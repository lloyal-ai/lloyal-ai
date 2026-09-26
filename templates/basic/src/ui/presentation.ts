/** What this app is called, said once. Every surface reads it from here: the page header, the browser tab, the
 *  desktop window, the terminal header, the served host and the dev pane. Change it whenever you like.
 *  Node-free, so every target can import it. */
export const APP = {
  name: "__NAME__",
} as const;
