import type { PlanState } from "../domain/work.js";
import type { Descriptor } from "@lloyal-labs/media";
import { emptyRoster } from "@lloyal-labs/ui/fold";
import type { AgentRoster } from "@lloyal-labs/ui/fold";
import type { AbilityDescriptor } from "@lloyal-labs/rig";
import type { Conversation, ConversationEntry, RunPhase } from "../protocol.js";
export { reduce } from "./reduce.js";

export interface AppState {
  ready: boolean;
  dev: boolean;
  error: string | null;
  abilities: AbilityDescriptor[];
  conversations: Record<string, Conversation>;
  entries: ConversationEntry[];
  activeId: string | null;
  search: { query: string; entries: ConversationEntry[] } | null;
  work: {
    conversationId: string;
    turnId: string;
    phase: RunPhase;
    paused: boolean;
    viewed: Descriptor[];
    roster: AgentRoster;
    keys: Record<number, string>;
    revisions: Record<number, number>;
    plan: PlanState | null;
    decision: string;
    coverage: string;
    outcomes: Record<string, { accepted: boolean; reason?: string }>;
  } | null;
}
export const initialState: AppState = {
  ready: false,
  dev: false,
  error: null,
  abilities: [],
  conversations: {},
  entries: [],
  activeId: null,
  search: null,
  work: null,
};
export const emptyWork = (
  conversationId: string,
  turnId: string,
): NonNullable<AppState["work"]> => ({
  conversationId,
  turnId,
  phase: "restoring",
  paused: false,
  viewed: [],
  roster: emptyRoster(),
  keys: {},
  revisions: {},
  plan: null,
  decision: "",
  coverage: "",
  outcomes: {},
});
