/**
 * Desktop renderer entry — mounts the shared `HarnessApp` (see `App.tsx`) under
 * the provider. The preload has already injected `window.harness` (IPC bridge)
 * before this runs.
 *
 * Same three lines as the web entry: the surface differs, the seam does not.
 */
import { createRoot } from "react-dom/client";
import { HarnessProvider } from "@lloyal-labs/ui";
import { HarnessApp } from "../../src/ui/App.js";
import { initialState, reduce } from "../../src/ui/state.js";

createRoot(document.getElementById("root")!).render(
  <HarnessProvider bridge={window.harness} initialState={initialState} reduce={reduce}>
    <HarnessApp surface="desktop" />
  </HarnessProvider>,
);
