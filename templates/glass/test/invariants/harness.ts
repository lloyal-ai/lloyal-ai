import { runHarness as runRig } from "@lloyal-labs/rig/testing";
import type { HarnessSpec } from "@lloyal-labs/rig/testing";
import { harness, config } from "../../src/app.js";
import type { Command, WorkflowEvent } from "../../src/protocol.js";
type Spec = HarnessSpec<typeof config, Command, WorkflowEvent>;
export const runHarness = (spec: Omit<Spec, "harness" | "config"> = {}) =>
  runRig({
    ...spec,
    harness,
    config: {
      table: config,
      yml: (outputDir) => ({
        model: { llm: { id: "qwen3.5-4b", context: 32768, branches: 5 } },
        sources: { outputDir },
      }),
    },
  });
