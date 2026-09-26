/**
 * Desktop renderer entry — mounts the shared `HarnessApp` under the provider.
 * The preload has already injected `window.harness` (the IPC bridge).
 */
import { createRoot } from "react-dom/client";
import { HarnessProvider } from "@lloyal-labs/ui";
import { HarnessApp } from "../../src/ui/App.js";
import { initialState, reduce } from "../../src/ui/state.js";
import { harnessTheme } from "../../src/ui/theme.js";
// The register's fonts, bundled: the desktop CSP and the local-first promise both rule out remote stylesheets.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

createRoot(document.getElementById("root")!).render(
  <div style={harnessTheme}>
    <HarnessProvider bridge={window.harness} initialState={initialState} reduce={reduce}>
      <HarnessApp />
    </HarnessProvider>
  </div>,
);
