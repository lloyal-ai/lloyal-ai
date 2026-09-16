/**
 * Every number the writing of a brief obeys. Effort is the reader's one knob;
 * each row is what it fans out to. A row is a `Budget` minus its prose: flat,
 * every field optional; `maxTasks` is the planner's own beside the pool's;
 * `recovery` holds the floors below which a reaped agent is not asked to
 * report — what it is told is a prompt, joined in `research.ts`, so the
 * interface can read a row without carrying the model's prose. `high` is the
 * tuned baseline; `medium`/`low` are starting estimates. The context limits
 * are ABSOLUTE free-KV reserves, not nCtx-derived.
 */

export type Effort = "low" | "medium" | "high" | "ultra";

/** Display order for the interface (lightest → heaviest). */
export const EFFORT_ORDER: readonly Effort[] = ["low", "medium", "high", "ultra"];

export const BUDGETS = {
  effort: {
    // The ceiling tier, hand-tuned for a large (~1M-token) nCtx; `maxTasks: 10` is past the planner's
    // tested boundary and worth a real run to calibrate.
    ultra: {
      maxTasks: 10, maxTurns: 10,
      context: { softLimit: 8192, hardLimit: 4096 },
      time: { softLimit: 600_000, hardLimit: 900_000 },
      shouldExplore: { context: 0.25 },   // explore until 75% of the KV is used, then exploit
      recoveryShape: "parallel",
    },
    high: {
      maxTasks: 6, maxTurns: 10,
      context: { softLimit: 2048, hardLimit: 1024 },
      time: { softLimit: 240_000, hardLimit: 360_000 },
      shouldExplore: { context: 0.4 },
      recoveryShape: "staggered",  // serial, full-headroom, lossless
    },
    medium: {
      maxTasks: 4, maxTurns: 10,
      context: { softLimit: 8192, hardLimit: 6144 },   // room for the in-loop recovery reports to bin-pack whole
      time: { softLimit: 150_000, hardLimit: 240_000 },
      shouldExplore: { context: 0.6 },
      recoveryShape: "parallel",
    },
    low: {
      maxTasks: 2, maxTurns: 10,
      context: { softLimit: 10240, hardLimit: 8192 },
      time: { softLimit: 90_000, hardLimit: 150_000 },
      shouldExplore: { context: 1.0 },   // always exploit: strict on-topic retrieval from the first turn
      recoveryShape: "parallel",
    },
  },
  /** A source probe is shallow: ~2 searches, then a report. Its turn cap is firm. The time is sized for the
   *  slowest probe path, one corpus search reranking the whole chunk index. One probe is enough signal to recover. */
  recon: {
    maxTurns: 4,
    context: { softLimit: 2048, hardLimit: 1024 },
    time: { softLimit: 120_000, hardLimit: 180_000 },
    recovery: { minToolCalls: 1 },
  },
  /** The settling pass has run unbounded until now; this row is that decision, made visible. */
  settle: { maxTurns: 10 },
  /** The passthrough: one turn on a fork of the trunk. */
  answer: { maxTurns: 1 },
  /** A direct ask keeps whatever it has: a reaped one is recovered below the research floors. */
  direct: { minToolCalls: 0, minTokens: 0 },
  /** Tool calls before a report is accepted: a first report short of it is refused once, then stands. */
  evidence: 2,
} as const;
