/**
 * The desktop target — your harness in a native window. Electron's main
 * process is a thin host over `@lloyal-labs/desktop`: it forks THIS project's
 * own cli bin as the engine (with `RR_BRIDGE=1`, so the cli boot mounts the
 * `ipc` binding instead of the terminal view), serves the content plane on the
 * `attachment://` scheme, and owns the window.
 */
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { cannotRun, createEngine, createWindow, placeHarness, registerContentScheme, serveContentScheme, serveEngine, CHANNELS } from "@lloyal-labs/desktop";
import type { HarnessPlacement } from "@lloyal-labs/desktop";
import type { Engine } from "@lloyal-labs/desktop";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent, Command } from "../../src/protocol.js";
import { APP } from "../../src/ui/presentation.js";
import { color } from "../../src/ui/theme.js";

// Before app ready, or it is ignored silently.
registerContentScheme();

let win: BrowserWindow | null = null;
let engine: Engine<Command, AppState> | null = null;

/** Send to the renderer only if the window is still alive (a destroyed window's `send` throws). */
function safeSend(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createTheEngine(place: HarnessPlacement): Engine<Command, AppState> {
  // The engine is THIS project's compiled cli boot; the package forks it, sets the bridge flag and pipes its output.
  // It runs where the app's own files are and works where this installation's work lives — the same place in a
  // project, two places once installed, because a bundle is read-only.
  return createEngine<WorkflowEvent, Command, AppState>({
    bin: join(place.appPath, "bin", "run.js"),
    cwd: place.cwd,
    projectRoot: place.dataRoot,
    initialState,
    reduce,
    forward: (frame) => safeSend(CHANNELS.event, frame),
    log: (stream, text) => (stream === "stderr" ? console.error : console.log)(`[engine] ${text}`),
  });
}

app.whenReady().then(() => {
  const place = placeHarness();
  engine = createTheEngine(place);
  serveContentScheme(place.dataRoot, (bytes, signal) => engine!.ingest(bytes, signal));
  const open = (): void => {
    win = createWindow({
      // electron-vite names the preload bundle after its entry and emits ESM as .mjs.
      preload: join(__dirname, "../preload/preload.mjs"),
      page: join(__dirname, "../renderer/index.html"),
      title: APP.name,
      window: { backgroundColor: color.ground },
    });
    win.on("closed", () => { win = null; });
  };
  open();
  serveEngine(engine, safeSend);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) open();
  });
  // Nothing above this line can be recovered from, and an installed app has no terminal to say so in.
}).catch(cannotRun);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("quit", () => engine?.kill());
