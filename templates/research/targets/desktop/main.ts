/**
 * The desktop target — your harness in a native window. Electron's main
 * process is a thin host over `@lloyal-labs/desktop`: it forks THIS project's
 * own cli bin as the engine (with `RR_BRIDGE=1`, so the cli boot mounts the
 * `ipc` binding instead of the terminal view), serves the content plane on the
 * `attachment://` scheme, and owns the window.
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { createEngine, createWindow, registerContentScheme, serveContentScheme, CHANNELS } from "@lloyal-labs/desktop";
import type { Engine } from "@lloyal-labs/desktop";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent, Command } from "../../src/brief/protocol.js";

// Before app ready, or it is ignored silently.
registerContentScheme();

let win: BrowserWindow | null = null;
let engine: Engine<Command, AppState> | null = null;

/** Send to the renderer only if the window is still alive (a destroyed window's `send` throws). */
function safeSend(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createTheEngine(): Engine<Command, AppState> {
  // The engine is THIS project's compiled cli boot; the package forks it, sets the bridge flag and pipes its output.
  // cwd stays the project root so the forked cli reads `harness.yml` and `models/`.
  return createEngine<WorkflowEvent, Command, AppState>({
    bin: join(process.cwd(), "bin", "run.js"),
    initialState,
    reduce,
    forward: (frame) => safeSend(CHANNELS.event, frame),
    log: (stream, text) => (stream === "stderr" ? console.error : console.log)(`[engine] ${text}`),
  });
}

app.whenReady().then(() => {
  engine = createTheEngine();
  serveContentScheme(process.cwd(), (bytes, signal) => engine!.ingest(bytes, signal));
  const open = (): void => {
    win = createWindow({
      // electron-vite names the preload bundle after its entry and emits ESM as .mjs.
      preload: join(__dirname, "../preload/preload.mjs"),
      page: join(__dirname, "../renderer/index.html"),
      title: "Fieldnote",
      window: { backgroundColor: "#0b0d12" },
    });
    win.on("closed", () => { win = null; });
  };
  open();
  // The session's life, relayed to whichever renderer is alive. The engine owns it; main carries it.
  engine.onSession((state) => safeSend(CHANNELS.session, state));
  ipcMain.on(CHANNELS.command, (_e, command: Command) => { engine?.send(command); });
  ipcMain.handle(CHANNELS.snapshot, () => engine!.snapshot());
  ipcMain.handle(CHANNELS.sessionNow, () => engine!.session());
  // A reader asking for a working harness. Here that is a new engine process — the renderer's own
  // IPC link never dropped, which is why this is not a reload.
  ipcMain.handle(CHANNELS.recover, () => engine!.restart());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) open();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("quit", () => engine?.kill());
