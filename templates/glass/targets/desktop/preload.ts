/**
 * The preload — `window.harness` for the renderer, the same bridge shape the
 * web target backs with `createBridge`, over Electron's contextBridge.
 */
import { preloadBridge } from "@lloyal-labs/desktop/preload";

preloadBridge();
