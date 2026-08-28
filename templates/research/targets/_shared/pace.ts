/** Observed pace, remembered per machine. The presets' time budgets are
 *  policy walls, not predictions — the same brief runs orders of magnitude
 *  apart on a laptop and a served GPU, so minutes are only ever quoted from
 *  what THIS machine actually did. Each settled brief records its wall time
 *  per line of inquiry, keyed by depth and shape; until one exists, no
 *  minutes show anywhere. */
import type { Depth, Shape } from "./select.js";

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const storage = (globalThis as { localStorage?: KV }).localStorage;
const KEY = "fieldnote.pace";

type Paces = Record<string, number>; // `${depth}/${shape}` → ms per inquiry

const read = (): Paces => {
  try {
    return JSON.parse(storage?.getItem(KEY) ?? "{}") as Paces;
  } catch {
    return {};
  }
};

/** Halved toward the newest run, so a machine that warms up (or a model
 *  swap) re-prices within a couple of briefs. */
export const recordPace = (depth: Depth, shape: Shape, tasks: number, ms: number): void => {
  if (tasks < 1 || ms <= 0) return;
  const paces = read();
  const key = `${depth}/${shape}`;
  const perTask = ms / tasks;
  paces[key] = paces[key] ? (paces[key] + perTask) / 2 : perTask;
  try {
    storage?.setItem(KEY, JSON.stringify(paces));
  } catch { /* private mode — minutes just stay unquoted */ }
};

export const paceOf = (depth: Depth, shape: Shape): number | null =>
  read()[`${depth}/${shape}`] ?? null;
