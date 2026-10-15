import type { Operation } from "effection";
import { RunnerCtx } from "@lloyal-labs/rig";
import type { Config } from "../config.js";
/** Read public, layered configuration; harness operations do not read process.env. */
export function* samplingSeed(): Operation<number> {
  const runner = yield* RunnerCtx.get();
  if (!runner) throw new Error("Glass needs the public runner configuration.");
  return (runner.config() as Config).sampling.seed;
}
