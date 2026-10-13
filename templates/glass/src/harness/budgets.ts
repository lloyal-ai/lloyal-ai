import { prompt } from "./prompts.js";
export const BUDGETS = {
  direct: {
    maxTurns: 10,
    context: { softLimit: 2048, hardLimit: 1024 },
    time: { softLimit: 180_000, hardLimit: 300_000 },
    recoveryBudget: 4096,
    recovery: {
      minTokens: 0,
      minToolCalls: 0,
      prompt: ({ budget }: { budget: number }) =>
        prompt("recovery", { budget }),
    },
  },
} as const;
