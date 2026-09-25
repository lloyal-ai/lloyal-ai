/**
 * The desktop target — your harness in a native window. Electron's main process
 * is a thin host over `@lloyal-labs/desktop`: it owns the window and forks THIS
 * project's own cli bin as the engine (with `RR_BRIDGE=1`, so the cli boot mounts
 * the `ipc` binding instead of the terminal view). Heavy work — native inference,
 * the Effection harness — lives in that forked process, so the UI never blocks.
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
import { createEngine, createWindow, serveEngine, CHANNELS } from "@lloyal-labs/desktop";
import type { Engine } from "@lloyal-labs/desktop";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent, Command } from "../../src/protocol.js";

let win: BrowserWindow | null = null;
let engine: Engine<Command, AppState> | null = null;

/** Send to the renderer only if the window is still alive (a destroyed window's `send` throws). */
function safeSend(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

app.whenReady().then(() => {
  // The engine is THIS project's compiled cli boot; the package forks it, sets the
  // bridge flag and pipes its output. cwd stays the project root so the forked cli
  // reads `harness.yml` and `models/`.
  engine = createEngine<WorkflowEvent, Command, AppState>({
    bin: join(process.cwd(), "bin", "run.js"),
    initialState,
    reduce,
    forward: (frame) => safeSend(CHANNELS.event, frame),
    log: (stream, text) => (stream === "stderr" ? console.error : console.log)(`[engine] ${text}`),
  });
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("quit", () => engine?.kill());
