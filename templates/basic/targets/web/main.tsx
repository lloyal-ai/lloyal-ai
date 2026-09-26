// Web renderer entry. The side-effect import runs FIRST — it installs
// `window.harness` (the wss bridge) before the provider connects it and the view mounts.
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
