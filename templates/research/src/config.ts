/** What this app can be configured with, declared once as data. Each key says where it may be set — `yml` in
 *  `harness.yml`, `cli` as a flag, `env` — what it may be, and what stands when nobody sets it. The `Config`
 *  type is read off this table, so a key added here is typed everywhere at once. Node-free: the view reads the
 *  same type. */
import { isGuardOverrides } from "@lloyal-labs/lloyal-agents";
import { defineConfig, modelSettings } from "@lloyal-labs/rig";
import type { ConfigOf, OriginOf } from "@lloyal-labs/rig";

export const config = defineConfig({
  ...modelSettings,   // the model block, with its own yml, env and cli names; per-ability config is layered in for every app
  "sources.outputDir": {
    yml: "sources.outputDir", cli: "outputDir", path: true, default: "reports",
    describe: "Where settled briefs, their annexures and the session trace are written; the library reads it back.",
  },
  "defaults.effort": {
    yml: "defaults.effort", oneOf: ["low", "medium", "high", "ultra"], default: "high",
    describe: "How much a run may spend: the plan's size, each inquiry's turns and time, and when a settling pass is reaped.",
  },
  "defaults.reasoningMode": {
    yml: "defaults.reasoningMode", cli: "reasoningMode", oneOf: ["flat", "deep"], default: "flat",
    describe: "flat surveys the plan's tasks side by side; deep investigates them one after another, each reading what the last found.",
  },
  "defaults.guards": {
    yml: "defaults.guards", check: isGuardOverrides,
    describe: "The harness's overrides for the agents' guards: which repeated searches and re-fetched URLs are refused, and at what scope.",
  },
});
export type Config = ConfigOf<typeof config>;
/** Which rung supplied each key: a default, `harness.yml`, the saved `harness.json`, the environment or a flag. */
export type Origin = OriginOf<typeof config>;
