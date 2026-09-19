/** What this app can be configured with, declared once as data. `modelSettings` is the model block with its
 *  yml paths and env names, layered for every app and never restated; `version` and the `abilities` family
 *  are rig's. Add a knob by adding a line: the key is the path in the resolved config, the entry says where
 *  each layer reads it and what it is. The mechanics — precedence, atomic writes, provenance, `~` expansion —
 *  are rig's. Node-free: the view reads the same table for its Settings tab. */
import { defineConfig, modelSettings } from "@lloyal-labs/rig";
import type { ConfigOf, OriginOf } from "@lloyal-labs/rig";

export const config = defineConfig({
  ...modelSettings,
  "sources.outputDir": { yml: "sources.outputDir", cli: "outputDir", path: true, default: ".", describe: "Where the session trace is written." },
});
export type Config = ConfigOf<typeof config>;
/** Which rung supplied each key: a default, `harness.yml`, the saved `harness.json`, the environment or a flag. */
export type Origin = OriginOf<typeof config>;
