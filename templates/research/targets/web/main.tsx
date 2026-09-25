// Web renderer entry. The side-effect import runs FIRST — it installs
// `window.harness` (the wss bridge) before the view mounts and subscribes.
import "./boot.js";
import { createRoot } from "react-dom/client";
import { HarnessProvider } from "@lloyal-labs/ui";
import { projectionFor } from "@lloyal-labs/ui";
import { HarnessApp } from "../../src/ui/App.js";
import { initialState, reduce } from "../../src/ui/state.js";
import { installHistory } from "../../src/ui/history.js";
import { harnessTheme } from "../../src/ui/theme.js";

createRoot(document.getElementById("root")!).render(
  <div style={harnessTheme}>
    <HarnessProvider bridge={window.harness} initialState={initialState} reduce={reduce}>
      <HarnessApp />
    </HarnessProvider>
  </div>,
);

// The URL rides the fold: '/brief/<docId>' ⇄ activeDocId, back/forward as
// document navigation, deep links restored from disk. Web-only — the shared
// view never knows URLs exist.
installHistory(projectionFor(window.harness, initialState, reduce), (c) => window.harness.send(c));
