/** What this app can be configured with, declared once as data. Each key says where it may be set — `yml` in
 *  `harness.yml`, `cli` as a flag, `env` — what it may be, and what stands when nobody sets it. The `Config`
 *  type is read off this table, so a key added here is typed everywhere at once. Node-free: the view reads the
 *  same type. */
import { isGuardOverrides } from "@lloyal-labs/lloyal-agents";
import { defineConfig, modelSettings } from "@lloyal-labs/rig";
import type { ConfigOf, OriginOf } from "@lloyal-labs/rig";

export const config = defineConfig({
  ...modelSettings,   // the model block, with its own yml, env and cli names; per-ability config is layered in for every app
  "sources.outputDir": { yml: "sources.outputDir", cli: "outputDir", path: true, default: "reports" },
  "defaults.effort": { yml: "defaults.effort", oneOf: ["low", "medium", "high", "ultra"], default: "high" },
  "defaults.reasoningMode": { yml: "defaults.reasoningMode", cli: "reasoningMode", oneOf: ["flat", "deep"], default: "flat" },
  "defaults.guards": { yml: "defaults.guards", check: isGuardOverrides },
});
export type Config = ConfigOf<typeof config>;
/** Which rung supplied each key: a default, `harness.yml`, the saved `harness.json`, the environment or a flag. */
export type Origin = OriginOf<typeof config>;
