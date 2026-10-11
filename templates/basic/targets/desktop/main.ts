/**
 * The desktop target — your harness in a native window. Electron's main process
 * is a thin host over `@lloyal-labs/desktop`: it owns the window and forks THIS
 * project's own cli bin as the engine (with `RR_BRIDGE=1`, so the cli boot mounts
 * the `ipc` binding instead of the terminal view), serves the content plane on the
 * `attachment://` scheme, and owns the window. Heavy work — native inference, the
 * Effection harness — lives in that forked process, so the UI never blocks.
 *
 * Streaming model (identical to cli/web): the engine emits raw `WorkflowEvent`s
 * and the package forwards each one (+ a monotonic `seq`) to the renderer, which
 * folds it through the SAME pure `reduce`. Only the small event crosses IPC,
 * never the growing transcript; the engine's own fold answers ONE snapshot per
 * (re)load, so a reload seeds from a consistent cut.
 */
import { app, BrowserWindow } from "electron";
import { APP } from "../../src/ui/presentation.js";
import { join } from "node:path";
import { cannotRun, createEngine, createWindow, placeHarness, prepareMicrophone, registerContentScheme, serveContentScheme, serveEngine, CHANNELS } from "@lloyal-labs/desktop";
import type { Engine } from "@lloyal-labs/desktop";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent, Command } from "../../src/protocol.js";

// Before app ready, or it is ignored silently.
registerContentScheme();

let win: BrowserWindow | null = null;
let engine: Engine<Command, AppState> | null = null;

/** Send to the renderer only if the window is still alive (a destroyed window's `send` throws). */
function safeSend(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

app.whenReady().then(() => {
  // The engine is THIS project's compiled cli boot; the package forks it, sets the
  // bridge flag and pipes its output. It runs where the app's own files are and works
  // where this installation's work lives — the same place in a project, two places
  // once installed, because a bundle is read-only.
  const place = placeHarness();
  engine = createEngine<WorkflowEvent, Command, AppState>({
    bin: join(place.appPath, "bin", "run.js"),
    cwd: place.cwd,
    projectRoot: place.dataRoot,
    initialState,
    reduce,
    // A harness that dictates asks for the microphone as its config arrives, before the models load.
    forward: (frame) => { safeSend(CHANNELS.event, frame); prepareMicrophone(frame.ev, () => win?.webContents ?? null); },
    log: (stream, text) => (stream === "stderr" ? console.error : console.log)(`[engine] ${text}`),
  });
  // The content plane: a recording the renderer makes travels up this scheme as bytes and comes back as a
  // reference the harness transcribes. The engine admits it; nothing in the window touches a file.
  serveContentScheme(place.dataRoot, (bytes, signal) => engine!.ingest(bytes, signal));
  const open = (): void => {
    win = createWindow({
      // electron-vite names the preload bundle after its entry and emits ESM as .mjs.
      preload: join(__dirname, "../preload/preload.mjs"),
      page: join(__dirname, "../renderer/index.html"),
      title: APP.name,
      window: { backgroundColor: "#ffffff" },
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
