import { defineConfig, loadEnv } from "vite";
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
 *
 * `resolve.preserveSymlinks` deliberately does NOT belong here, though it looks
 * like it should. It makes the symlink path canonical, so a linked package's own
 * dependencies are then looked for in THIS project — and they are not here, they
 * are in the workspace (`@lloyal-labs/ui` owns katex, react-markdown and the rest).
 * It repairs `build:web` under a link and breaks `npm run dev:web`, which is the
 * one thing a link is for. The production bundles are proven against PACKED
 * artifacts, where nothing is symlinked and both work; building under a link is
 * not a supported combination and never has been.
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
 * `web-bridge.ts`). Point it elsewhere with `VITE_WSS_URL` or `?server=`; the
 * content plane follows the same host automatically (`VITE_CONTENT_URL` /
 * `?content=` override it independently).
 */
export default defineConfig(({ mode }) => {
  // The host's own settings, read from the SAME files `bin/serve.js` reads and in the same order of
  // authority: a real environment variable, then `.env.local`, then the committed `.env`. Moving the
  // host has to move its clients with it — the socket the page opens and the proxy its uploads take
  // — or following the one documented place to configure it disconnects the app.
  const file = loadEnv(mode, __dirname, "");
  const host = process.env.HOST ?? file.HOST ?? "127.0.0.1";
  const port = process.env.PORT ?? file.PORT ?? "8787";
  const origin = `http://${host}:${port}`;

  return {
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
        // named exports simply are not there. `test/invariants/linked-view.test.ts` holds this list to the
        // view's imports.
        optimizeDeps: {
          include: [
            "@lloyal-labs/binding",
            "@lloyal-labs/binding/web",
            "@lloyal-labs/lloyal-agents",
            "@lloyal-labs/media",
            "@lloyal-labs/rig",
            "@lloyal-labs/ui",
            "@lloyal-labs/ui/fold",
            "@lloyal-labs/ui/prose",
            "@lloyal-labs/dev-tools/react",
          ],
        },
      }
    : {}),
  // The page's default socket, resolved here so it cannot drift from the proxy below or from the
  // host itself. `VITE_WSS_URL` and `?server=` still point it somewhere else entirely.
  define: { __DEFAULT_WSS__: JSON.stringify(`ws://${host}:${port}`) },
  server: {
    port: 5173,
    ...(workspace ? { fs: { allow: [resolve(__dirname, "../.."), workspace] } } : {}),
    // Both planes of the served host reach the browser through THIS origin in
    // dev: the page is on :5173, the host wherever it was configured. Proxying
    // the content plane keeps its requests same-origin, so no CORS preflight is
    // involved and the host needs no `allowedOrigin` for local work.
    // `/v1/media` carries uploads and representations; `/v1/content` answers
    // existence by digest.
    proxy: {
      "/v1/media": { target: origin, changeOrigin: true },
      "/v1/content": { target: origin, changeOrigin: true },
    },
  },
  build: { outDir: resolve(__dirname, "../../dist-web"), emptyOutDir: true },
  };
});
