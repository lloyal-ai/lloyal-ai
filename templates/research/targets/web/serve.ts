/**
 * `bin/serve.js`'s entry — the web target's served host: N browser Sessions
 * over ONE resident model, the SAME `harness(ctx, events, commands)` the cli
 * and desktop run. Everything below the seam is rig's `bootServed`.
 */
import { bootServed } from "@lloyal-labs/rig/node";
import { harness, abilities, config } from "../../src/app.js";
import { APP } from "../../src/ui/presentation.js";

bootServed({ harness, abilities, config }, { name: APP.name });
