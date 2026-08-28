/** Observed pace, remembered per machine — seeded with stated priors. The
 *  presets' time budgets are policy walls, not predictions, so minutes
 *  start from an honest guess (~4 min an inquiry in a chain, ~2 min
 *  effective side by side where tool waits overlap, plus the settling
 *  pass) and are replaced by what THIS machine actually does: each settled
 *  brief records its wall time, keyed by depth and shape, halved toward
 *  the newest run. */
import { EFFORT_PRESETS } from "../../harness/effort-presets.js";
import type { Depth, Shape } from "./select.js";

export interface Pace {
  perTaskMs: number;
  synthMs: number;
  /** False while the figure is still the prior, not this machine's. */
  observed: boolean;
}

/** Anchored at Standard; `depthFactor` scales them — a Thorough inquiry
 *  works its task longer than a Quick one, in proportion to its budget. */
const PRIOR: Record<Shape, { perTaskMs: number; synthMs: number }> = {
  investigation: { perTaskMs: 240_000, synthMs: 240_000 },
  survey: { perTaskMs: 120_000, synthMs: 360_000 },
};

const depthFactor = (depth: Depth): number =>
  EFFORT_PRESETS[depth].budget.time.softLimit /
  EFFORT_PRESETS.medium.budget.time.softLimit;

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

export const paceFor = (depth: Depth, shape: Shape): Pace => {
  const stored = read()[`${depth}/${shape}`];
  const { perTaskMs, synthMs } = PRIOR[shape];
  return stored != null
    ? { perTaskMs: stored, synthMs, observed: true }
    : { perTaskMs: perTaskMs * depthFactor(depth), synthMs, observed: false };
};

/** Halved toward the newest run, so a machine that warms up (or throttles
 *  on battery) re-prices within a couple of briefs. The settling pass is
 *  netted out at its prior before the per-inquiry figure is stored. */
export const recordPace = (depth: Depth, shape: Shape, tasks: number, ms: number): void => {
  if (tasks < 1 || ms <= 0) return;
  const paces = read();
  const key = `${depth}/${shape}`;
  const perTask = Math.max(30_000, (ms - PRIOR[shape].synthMs) / tasks);
  paces[key] = paces[key] ? (paces[key] + perTask) / 2 : perTask;
  try {
    storage?.setItem(KEY, JSON.stringify(paces));
  } catch { /* private mode — the priors just stay */ }
};
