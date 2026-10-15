import type { Mode, Plan, PlanState } from "./domain/work.js";
import type { Preferences } from "./domain/preferences.js";
import type { Selection } from "./domain/answer.js";
import type { Descriptor } from "@lloyal-labs/media";
import type { VoiceCommand, VoiceEvent } from "@lloyal-labs/binding";
import type { AgentEvent } from "@lloyal-labs/lloyal-agents";
import type {
  HostResourcesEvent,
  RunCommand,
  SettingsCommand,
  SettingsEvent,
} from "@lloyal-labs/rig";
import type { Config, Origin } from "./config.js";
import type { Conversation, ConversationEntry } from "./domain/conversation.js";
export type {
  Conversation,
  ConversationEntry,
  Turn,
} from "./domain/conversation.js";

export type Command =
  | VoiceCommand
  | RunCommand
  | SettingsCommand<Config>
  | {
      type: "submit_query";
      query: string;
      conversationId?: string | null;
      revision?: number;
      attachments?: Descriptor[];
      excluded?: string[];
      mode?: Mode;
      selection?: Selection;
      preferences?: Preferences;
    }
  | { type: "steer_work"; turnId: string; revision: number; query: string }
  | { type: "approve_plan"; turnId: string; revision: number }
  | { type: "revise_plan"; turnId: string; revision: number; plan: Plan }
  | { type: "search_conversations"; query: string }
  | { type: "finish_work"; turnId: string }
  | { type: "open_conversation"; id: string | null }
  | { type: "list_conversations" }
  | { type: "discard_conversation"; id: string; revision: number }
  | { type: "discard_turn"; id: string; turnId: string; revision: number }
  | {
      type: "continue_conversation";
      id: string;
      turnId: string;
      revision: number;
    }
  | {
      type: "check_item";
      id: string;
      turnId: string;
      revision: number;
      index: number;
      checked: boolean;
    }
  | { type: "keep_partial"; id: string; turnId: string; revision: number }
  | { type: "quit" };

export type RunPhase =
  | "restoring"
  | "deciding"
  | "review"
  | "preflight"
  | "answering"
  | "revising"
  | "working"
  | "stopping"
  | "idle";
export type WorkflowEvent =
  | VoiceEvent
  | AgentEvent
  | SettingsEvent<Config, Origin>
  | HostResourcesEvent
  | { type: "weights:done" }
  | { type: "conversation"; record: Conversation }
  | { type: "conversation:active"; id: string | null }
  | { type: "conversation:removed"; id: string }
  | { type: "conversations"; entries: ConversationEntry[] }
  | { type: "work:start"; conversationId: string; turnId: string }
  | { type: "work:phase"; phase: RunPhase }
  | {
      type: "work:ended";
      conversationId: string;
      turnId: string;
      reason: string;
    }
  | { type: "media:admitted"; roots: Descriptor[] }
  | { type: "work:plan"; state: PlanState }
  | { type: "work:decision"; reason: string }
  | { type: "work:scope"; inputs: string[]; excluded: string[] }
  | { type: "work:coverage"; text: string }
  | {
      type: "work:outcome";
      id: string;
      revision: number;
      accepted: boolean;
      reason?: string;
    }
  | {
      type: "conversations:search";
      query: string;
      entries: ConversationEntry[];
    }
  | { type: "work:paused"; paused: boolean };

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
export { HarnessExit } from "@lloyal-labs/rig";
