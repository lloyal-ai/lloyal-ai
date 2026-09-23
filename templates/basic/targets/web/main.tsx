// Web renderer entry. The side-effect import runs FIRST — it installs
// `window.harness` (the wss bridge) before the shared view mounts and subscribes.
//
// `HarnessProvider` owns the subscription for every surface: it seeds from the
// bridge's snapshot, holds frames until that lands, and re-seeds when the
// stream's epoch changes. The view below reads it through hooks and never
// wires a bridge itself.
import "./boot.js";
import { createRoot } from "react-dom/client";
import { HarnessProvider } from "@lloyal-labs/ui";
import { HarnessApp } from "../../src/ui/App.js";
import { initialState, reduce } from "../../src/ui/state.js";

createRoot(document.getElementById("root")!).render(
  <HarnessProvider bridge={window.harness} initialState={initialState} reduce={reduce}>
    <HarnessApp surface="web" />
  </HarnessProvider>,
);
