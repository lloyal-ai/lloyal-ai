/** What the dev tools are told about this app, for both the docked pane and the terminal overlay. They know no
 *  harness's event names, so the app says which of ITS events open and close a run, which mark the phases the
 *  agent lanes are labelled with, and where the reader's question is. Every name is checked against the wire:
 *  renaming an event stops this compiling until it follows. Node-free. */
import type { RunFraming } from "@lloyal-labs/dev-tools";
import type { WorkflowEvent } from "../brief/protocol.js";

type Wire = WorkflowEvent["type"];

export const FRAMING: RunFraming = {
  // What every agent spawned after a marker is labelled with. The brief opens the round before the planner
  // probes, so the probes' end is a marker too: the planner that follows it is a planner, not another probe.
  phases: {
    "plan:start": "planner",
    "preflight:start": "recon",
    "preflight:done": "planner",
    "research:start": "research",
    "synthesize:start": "synth",
  } satisfies Partial<Record<Wire, string>>,
  // In the order the wire says them: the echo of the question first on every path, then the markers that
  // follow it. A marker at or before the last one seen is read as a new run superseding an unclosed one.
  open: ["query", "plan:start", "preflight:start"] satisfies Wire[],
  close: ["complete", "run:aborted"] satisfies Wire[],
  instruction: { event: "query" satisfies Wire, field: "query", attachments: "attachments" },
};
