/**
 * `bin/serve.js`'s entry — the web target's served host: N browser Sessions over
 * ONE resident model, the SAME `harness(ctx, events, commands)` the cli and
 * desktop run. Everything below the seam is rig's `bootServed`: the resident
 * model, the per-session context and reranker, the content plane, and the `ws`
 * front door.
 *
 * `npm run serve` builds + starts this; then `npm run dev:web` serves the browser
 * app that talks to it. The box's own settings — PORT, HOST, MAX_SESSIONS — come
 * from the environment, because they describe the machine and not the harness.
 */
import { bootServed } from "@lloyal-labs/rig/node";
import { APP } from "../../src/ui/presentation.js";
import { harness, abilities, config } from "../../src/app.js";

bootServed({ harness, abilities, config }, { name: APP.name });
