import { foldAgents } from "@lloyal-labs/ui/fold";
import type { AgentEvent as FoldEvent } from "@lloyal-labs/ui/fold";
import type { WorkflowEvent } from "../protocol.js";
import { emptyWork, type AppState } from "./state.js";

export function reduce(state: AppState, event: WorkflowEvent): AppState {
  switch (event.type) {
    case "weights:done":
      return { ...state, ready: true };
    case "config:loaded":
      return { ...state, dev: event.dev };
    case "abilities:state":
      return { ...state, abilities: event.abilities };
    case "ui:error":
      return { ...state, error: event.message };
    case "conversation":
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [event.record.id]: event.record,
        },
      };
    case "conversation:active":
      return { ...state, activeId: event.id, error: null };
    case "conversation:removed": {
      const conversations = { ...state.conversations };
      delete conversations[event.id];
      return {
        ...state,
        conversations,
        entries: state.entries.filter((entry) => entry.id !== event.id),
        search: state.search
          ? {
              ...state.search,
              entries: state.search.entries.filter(
                (entry) => entry.id !== event.id,
              ),
            }
          : null,
        activeId: state.activeId === event.id ? null : state.activeId,
      };
    }
    case "conversations":
      return { ...state, entries: event.entries };
    case "conversations:search":
      return {
        ...state,
        search: { query: event.query, entries: event.entries },
      };
    case "work:plan":
      return state.work
        ? {
            ...state,
            work: {
              ...state.work,
              plan: event.state,
              outcomes:
                state.work.plan?.revision === event.state.revision
                  ? state.work.outcomes
                  : {},
            },
          }
        : state;
    case "work:decision":
      return state.work
        ? { ...state, work: { ...state.work, decision: event.reason } }
        : state;
    case "work:scope":
      return state.work
        ? { ...state, work: { ...state.work, viewed: [], coverage: "" } }
        : state;
    case "work:coverage":
      return state.work
        ? { ...state, work: { ...state.work, coverage: event.text } }
        : state;
    case "work:outcome":
      return state.work?.plan?.revision === event.revision
        ? {
            ...state,
            work: {
              ...state.work,
              outcomes: {
                ...state.work.outcomes,
                [event.id]: { accepted: event.accepted, reason: event.reason },
              },
            },
          }
        : state;
    case "work:start":
      return {
        ...state,
        error: null,
        work: emptyWork(event.conversationId, event.turnId),
      };
    case "work:phase":
      return state.work
        ? { ...state, work: { ...state.work, phase: event.phase } }
        : state;
    case "media:admitted":
      return state.work
        ? {
            ...state,
            work: {
              ...state.work,
              viewed: [
                ...state.work.viewed,
                ...event.roots.filter(
                  (r) => !state.work!.viewed.some((v) => v.digest === r.digest),
                ),
              ],
            },
          }
        : state;
    case "agent:prefilled":
      return event.attachments?.length
        ? reduce(state, {
            type: "media:admitted",
            roots: [...event.attachments],
          })
        : state;
    case "work:paused":
      return state.work
        ? { ...state, work: { ...state.work, paused: event.paused } }
        : state;
    case "work:ended":
      return state.work?.turnId === event.turnId
        ? { ...state, work: { ...state.work, phase: "idle", paused: false } }
        : state;
    default: {
      if (!event.type.startsWith("agent:") || !state.work) return state;
      const keys =
        event.type === "agent:spawn"
          ? { ...state.work.keys, [event.agentId]: event.key ?? "decision" }
          : state.work.keys;
      const roster = foldAgents(state.work.roster, event as FoldEvent, {
        terminal: "report",
        spawn: (e) => ({
          timeline: true,
          taskIndex:
            state.work!.plan?.plan.tasks.findIndex((t) => t.id === e.key) ??
            null,
        }),
      });
      return roster === state.work.roster && keys === state.work.keys
        ? state
        : {
            ...state,
            work: {
              ...state.work,
              roster,
              keys,
              revisions:
                event.type === "agent:spawn"
                  ? {
                      ...state.work.revisions,
                      [event.agentId]: state.work.plan?.revision ?? 0,
                    }
                  : state.work.revisions,
            },
          };
    }
  }
}
