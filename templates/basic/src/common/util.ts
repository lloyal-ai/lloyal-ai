/** Stateless helpers over text, owned by neither half — the slot for a helper that is about strings rather
 *  than about your program or your view. Today every caller happens to be a view.
 *
 *  NODE-FREE, and that is a contract rather than a description: `src/ui/state.ts` imports these, and it is
 *  itself imported by the Electron MAIN process and by the served web target. A `node:` import here breaks
 *  the browser bundle, so anything needing the filesystem belongs where it is used, not in this file. */

/** The newest line worth showing, for a one-line preview of something still streaming. */
export const lastLine = (text: string): string =>
  text.split("\n").filter((l) => l.trim()).slice(-1)[0] ?? "";

/** A URL-safe anchor slug. ONE rule, shared: the Contents link and the heading id must agree or the
 *  links do not resolve, and two derivations that must agree are one derivation with extra steps. */
export const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 64) || "section";
