/**
 * The runner ↔ harness seam, typed to THIS harness's config. The context and
 * the `Runner` machinery are rig's (`makeEdgeRunner` / `makeServedRunner`);
 * only the `Config`/`ConfigOrigin` shapes are yours, and this cast marries
 * them. Boots set it; `harness.ts` and `pipeline.ts` read it — its own module
 * so neither has to import the other to share it.
 */
import { RunnerCtx as RigRunnerCtx } from "@lloyal-labs/rig";
import type { Runner } from "@lloyal-labs/rig";
import type { Context } from "effection";
import type { Config, ConfigOrigin } from "./config-types.js";

export const RunnerCtx = RigRunnerCtx as Context<Runner<Config, ConfigOrigin>>;
