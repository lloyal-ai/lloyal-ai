/** What the dev tools are told about this app, for both the docked pane and the terminal overlay. They know no
 *  harness's event names, so the app says which of ITS events open and close a run and where the reader's
 *  question is. Every name is checked against the wire: renaming an event stops this compiling until it
 *  follows. Node-free. */
import type { RunFraming } from "@lloyal-labs/dev-tools";
import type { WorkflowEvent } from "../harness/protocol.js";

type Wire = WorkflowEvent["type"];

export const FRAMING: RunFraming = {
  phases: {},   // one stage: an agent is an agent
  open: ["query"] satisfies Wire[],
  close: ["answer", "error"] satisfies Wire[],
  instruction: { event: "query" satisfies Wire, field: "text" },
};
