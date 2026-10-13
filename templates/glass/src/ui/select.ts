import { extractStreamingReport } from "@lloyal-labs/ui/fold";
import type { AgentRuntime } from "@lloyal-labs/ui/fold";
import type { AppState } from "./state.js";
export const activeConversation = (state: AppState) =>
  state.activeId ? state.conversations[state.activeId] : undefined;
export const isWorking = (state: AppState) =>
  !!state.work && state.work.phase !== "idle";
export function agentText(agent: AgentRuntime | undefined): string {
  if (!agent) return "";
  const report = agent.timeline
    ?.filter((item) => item.kind === "report")
    .at(-1);
  if (report?.kind === "report") {
    // Typed answer results are displayed from the accepted conversation payload, not raw JSON.
    if (report.body.trim().startsWith("{")) return "";
    return report.body;
  }
  const buffer = agent.contentBuffer || agent.draft || "";
  return (
    extractStreamingReport(buffer, { tool: "report" }) ??
    (!buffer.trim().startsWith("{") && !buffer.includes("<tool_call>")
      ? buffer
      : "")
  );
}
export function streamedAnswer(state: AppState): string {
  const latest = [...(state.work?.roster.agents.values() ?? [])]
    .reverse()
    .find((a) => state.work?.keys[a.id] === "answer");
  return agentText(latest);
}
