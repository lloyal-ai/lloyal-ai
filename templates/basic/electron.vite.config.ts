import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";

/**
 * True only when the framework is SYMLINKED in rather than installed — a
 * workspace checkout (`lloyal link-local`), never a generated app. Vite does not
 * pre-bundle a linked dependency, so the renderer needs it named explicitly. See
 * the web config for why `resolve.preserveSymlinks` is NOT the answer here.
 */
const linked =
  lstatSync(resolve(__dirname, "node_modules/@lloyal-labs/binding"), { throwIfNoEntry: false })
    ?.isSymbolicLink() ?? false;

/**
 * A linked package resolves to its REAL path, outside `node_modules`, and Vite's
 * CommonJS interop looks only under `node_modules` — so a bundled platform package
 * (the preload's bridge, the renderer's `ui`) would be parsed as ESM and its
 * exports reported missing. On a linked tree the interop is told where the
 * workspace's built output lives as well. A generated app never reaches this.
 */
const commonjsWhereLinked = linked ? { commonjsOptions: { include: [/node_modules/, /\/dist\//] } } : {};

/**
 * The desktop target's 3-process build (`npm run dev:desktop` / `build:desktop`).
 * `main` is a Node process and leaves its dependencies on disk to be resolved at
 * runtime; `preload` cannot, and bundles its bridge in — see below. The
 * `renderer` is a normal Vite React app rooted at `targets/desktop`, folding
 * `src/ui/state.ts`'s `reduce`. The entries live under `targets/desktop/`; this
 * config sits at the project root because that is where `electron-vite` looks.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, "targets/desktop/main.ts") },
    },
  },
  preload: {
    // The preload runs before the renderer, in a context with constrained module
    // resolution: a bare specifier left for runtime can fail with NO console to
    // report it, leaving `window.harness` undefined and a blank window — a fault
    // in neither the view nor the engine, and visible from neither. So the bridge
    // alone is BUNDLED in, and `electron` itself stays external, as it must. This
    // holds however the package arrived, linked or installed.
    plugins: [externalizeDepsPlugin({ exclude: ["@lloyal-labs/desktop"] })],
    build: {
      lib: { entry: resolve(__dirname, "targets/desktop/preload.ts") },
      ...commonjsWhereLinked,
    },
  },
  renderer: {
    root: resolve(__dirname, "targets/desktop"),
    plugins: [react()],
    // Every CommonJS platform package the renderer reaches, directly or through `ui`: the dev server serves a
    // linked package as source and never pre-bundles it, so a CommonJS one reaches the browser unconverted and
    // the window stays blank. Named here, the optimizer converts them as it would from `node_modules`.
    ...(linked
      ? {
          optimizeDeps: { include: ["@lloyal-labs/media", "@lloyal-labs/binding", "@lloyal-labs/rig", "@lloyal-labs/lloyal-agents"] },
          // A linked `ui` resolves React up its real path, into the workspace's own copy — a second React beside
          // this app's, and hooks refuse to run across two. One React: the project's.
          resolve: { dedupe: ["react", "react-dom"] },
        }
      : {}),
    build: {
      rollupOptions: { input: resolve(__dirname, "targets/desktop/index.html") },
      ...commonjsWhereLinked,
    },
  },
});
