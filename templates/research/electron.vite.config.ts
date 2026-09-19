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
    },
  },
  renderer: {
    root: resolve(__dirname, "targets/desktop"),
    plugins: [react()],
    ...(linked ? { optimizeDeps: { include: ["@lloyal-labs/media"] } } : {}),
    build: {
      rollupOptions: { input: resolve(__dirname, "targets/desktop/index.html") },
    },
  },
});
