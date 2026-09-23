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
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { APP } from "../../src/ui/presentation.js";
import { join } from "node:path";
import { createEngine, createWindow, CHANNELS } from "@lloyal-labs/desktop";
import type { Engine } from "@lloyal-labs/desktop";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent, Command } from "../../src/protocol.js";

let win: BrowserWindow | null = null;
let engine: Engine<Command, AppState> | null = null;

/** Send to the renderer only if the window is still alive (a destroyed window's `send` throws). */
function safeSend(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** One file, opened for reading. `extensions` comes from the caller because what
 *  counts as a model is the engine's business, not this shell's. */
function dialogOptions(opts?: { extensions?: string[]; title?: string }) {
  return {
    title: opts?.title ?? "Choose a file",
    properties: ["openFile" as const],
    ...(opts?.extensions?.length
      ? { filters: [{ name: "Models", extensions: opts.extensions }] }
      : {}),
  };
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
  // The session's life, relayed to whichever renderer is alive. The engine owns it; main carries it.
  engine.onSession((state) => safeSend(CHANNELS.session, state));
  ipcMain.on(CHANNELS.command, (_e, command: Command) => { engine?.send(command); });
  ipcMain.handle(CHANNELS.snapshot, () => engine!.snapshot());
  ipcMain.handle(CHANNELS.sessionNow, () => engine!.session());
  // A reader asking for a working harness. Here that is a new engine process — the
  // renderer's own IPC link never dropped, which is why this is not a reload.
  ipcMain.handle(CHANNELS.recover, () => engine!.restart());
  // What is being acquired, for a renderer that loaded after the install began.
  // The engine retains it beside the session for the same reason: a window that
  // opens mid-download — or after a refusal ended the run — must not be left
  // guessing. Never folded into the app's state; acquiring weights is not this
  // app's business.
  ipcMain.handle(CHANNELS.installNow, () => engine?.install() ?? null);
  // Choosing a local model rather than downloading one. The dialog is main's
  // because only main has a filesystem; the renderer gets back a PATH, which is
  // what `model.llm.path` takes and why a browser cannot offer this at all.
  ipcMain.handle(
    CHANNELS.chooseFile,
    async (_e, opts?: { extensions?: string[]; title?: string }) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const picked = await (win
        ? dialog.showOpenDialog(win, dialogOptions(opts))
        : dialog.showOpenDialog(dialogOptions(opts)));
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
  );
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) open();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("quit", () => engine?.kill());
