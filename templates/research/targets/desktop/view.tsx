/**
 * Desktop renderer entry — mounts the shared `HarnessApp` under the provider.
 * The preload has already injected `window.harness` (the IPC bridge).
 */
import { createRoot } from "react-dom/client";
import { HarnessProvider } from "@lloyal-labs/ui";
import { HarnessApp } from "../../src/ui/App.js";
import { initialState, reduce } from "../../src/ui/state.js";

createRoot(document.getElementById("root")!).render(
  <HarnessProvider bridge={window.harness} initialState={initialState} reduce={reduce}>
    <HarnessApp />
  </HarnessProvider>,
);
