import { defineConfig, modelSettings } from "@lloyal-labs/rig";
import type { ConfigOf, OriginOf } from "@lloyal-labs/rig";

export const config = defineConfig({
  ...modelSettings,
  "sampling.seed": {
    yml: "sampling.seed",
    env: "GLASS_SEED",
    integer: true,
    default: 42,
    describe: "Base sampling seed; useful for reproducible evaluations.",
  },
  "sources.outputDir": {
    yml: "sources.outputDir",
    cli: "outputDir",
    path: true,
    default: "conversations",
    describe:
      "Durable conversation records. One host process owns this directory.",
  },
});
export type Config = ConfigOf<typeof config>;
export type Origin = OriginOf<typeof config>;
