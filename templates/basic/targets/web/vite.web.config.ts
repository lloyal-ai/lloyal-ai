import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * True only when the framework is SYMLINKED in rather than installed — a
 * workspace checkout (`lloyal link-local`), never a generated app.
 *
 * Vite does not pre-bundle a linked dependency by default, so the platform's
 * CommonJS entries reach the browser unconverted and their named exports vanish.
 * Naming them here restores the DEV server; an installed app needs none of it.
 */
const link = resolve(__dirname, "../../node_modules/@lloyal-labs/binding");
const linked = lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
/**
 * The workspace the link points into. `server.fs.allow` defaults to the project
 * root, so without this the dev server REFUSES to read a linked package at all —
 * "outside of Vite serving allow list", logged by the server and invisible in the
 * browser, which only shows a blank page. Derived from the link itself so no path
 * is hard-coded: `<workspace>/packages/binding` → `<workspace>`.
 */
const workspace = linked ? resolve(realpathSync(link), "..", "..") : null;

/**
 * The web target's browser app (`npm run dev:web` / `npm run build:web`). Rooted
 * at `targets/web`; it connects to the local `npm run serve` host over wss (see
 * `web-bridge.ts`). Point it elsewhere with `VITE_WSS_URL` or `?server=`.
 */
export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  ...(linked
    ? {
        // React must be ONE instance. A linked package resolves its peers up its
        // REAL path, so `@lloyal-labs/ui` would take the workspace's React while
        // the app takes its own — two copies, two dispatchers, and every hook the
        // provider calls throws. It surfaces as a blank page with the component
        // name and nothing else, which is why it is worth naming here.
        resolve: { dedupe: ["react", "react-dom"] },
        // EVERY platform entry the browser can reach, not just the ones this file
        // names: an omission is invisible until the page is blank, because the
        // missing one is served raw from outside the project and its CommonJS
        // named exports simply are not there. `test/invariants/linked-view.test.ts`
        // holds this list to the view's imports.
        optimizeDeps: {
          include: [
            "@lloyal-labs/binding",
            "@lloyal-labs/binding/web",
            "@lloyal-labs/rig",
            "@lloyal-labs/ui",
            "@lloyal-labs/ui/fold",
            "@lloyal-labs/ui/prose",
            "@lloyal-labs/dev-tools/react",
          ],
        },
      }
    : {}),
  server: {
    port: 5173,
    ...(workspace ? { fs: { allow: [resolve(__dirname, "../.."), workspace] } } : {}),
  },
  build: { outDir: resolve(__dirname, "../../dist-web"), emptyOutDir: true },
});
