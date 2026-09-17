/** One agent's work, in the reader's language: what it is doing right now, the prose it has written so far,
 *  and the whole stream of its work for anyone who opens it. Every moment that shows an agent reads it here. */
import { extractStreamingReport, type AppState, type DocState, type AgentRuntime, type TimelineItem } from "../state.js";
import { RIG_REPORT, type Reports } from "../../brief/protocol.js";
import { activeDoc } from "./canvas.js";

/** One step of an inquiry's activity, in the librarian's voice. */
export interface InquiryVerb {
  kind: "thinking" | "working" | "waiting" | "writing" | "settled" | "kept" | "failed";
  text: string;
  /** For "waiting": when the retry fires (ms epoch), for the countdown. */
  retryAt?: number;
}

export interface Inquiry {
  /** Stable identity shared with the dev pane's lanes. */
  id: number;
  index: number;
  verb: InquiryVerb;
  startedAt: number;
  endedAt: number | null;
}

const TOOL_DOING: Record<string, string> = {
  web_search: "Searching",
  fetch_page: "Reading",
  search: "Searching",
};
const TOOL_DONE: Record<string, string> = {
  web_search: "Searched",
  fetch_page: "Read",
  search: "Searched",
};
export const doing = (tool: string): string =>
  TOOL_DOING[tool] ?? (/search/i.test(tool) ? "Searching" : "Reading");
const doneVerb = (tool: string): string =>
  TOOL_DONE[tool] ?? (/search/i.test(tool) ? "Searched" : "Read");

export const resultMeta = (t: Extract<TimelineItem, { kind: "tool_result" }>): string => {
  const meta = t.resultCount != null
    ? `${t.resultCount} results`
    : `${(t.byteLength / 1000).toFixed(1)} kb`;
  return `${doneVerb(t.tool)} — ${meta}${t.hosts[0] ? ` · ${t.hosts[0]}` : ""}`;
};

/** How the agents of this document hand in their findings: what `research:start` said of the run, else rig's
 *  own report tool, which is also what rig's source probes end on. */
export const handingIn = (doc: DocState): Reports => doc.reports ?? RIG_REPORT;

/** The findings as the model writes them, read out of the terminal tool's call once it opens — that tool's call
 *  and no other: an ordinary tool may share the argument's name. An agent that was cut short and asked to report
 *  may write bare prose with no call around it; leading tag fragments are held back until real text arrives. */
export const liveProse = (a: AgentRuntime, reports: Reports): string | null => {
  const report = reports.field === null ? null : extractStreamingReport(a.contentBuffer, { tool: reports.tool, field: reports.field });
  if (report !== null) return report;
  if (!a.recovering) return null;
  return a.contentBuffer.replace(/^(?:\s*<[^>\n]*>?\n?)*/, "") || null;
};

/** The findings may arrive as the terminal tool's raw JSON arguments — unwrap the findings' own argument, and
 *  only when parsing yields exactly that shape. */
const reportBody = (body: string, field: string | null): string => {
  if (field !== null && body.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (typeof parsed?.[field] === "string") return parsed[field] as string;
    } catch { /* raw markdown */ }
  }
  return body;
};

/** The attempt at each task that counts — the CURRENT one. A task may be attempted more than once (a heal
 *  re-spawns it under the same task), and the roster keeps every attempt for the dev pane's lanes; the reader
 *  is shown the latest, which is the last one the roster took in. */
export const currentAttempts = (doc: DocState): Map<number, AgentRuntime> => {
  const byTask = new Map<number, AgentRuntime>();
  for (const a of doc.roster.agents.values()) if (a.taskIndex !== null) byTask.set(a.taskIndex, a);
  return byTask;
};

/** Failure, in the librarian's voice. Unlisted reasons are mechanical
 *  (decode errors) — the dev pane keeps the detail. */
const FAIL_TEXT: Record<string, string> = {
  user_cancel: "dropped — left out of the brief",
  time_exceeded: "out of time — kept what it had",
  wind_down: "closed early — kept what it had",
};
const failText = (reason: string): string =>
  FAIL_TEXT[reason] ?? "couldn't finish this line of inquiry";

export const verbOf = (a: AgentRuntime, reports: Reports): InquiryVerb => {
  if (a.failReason) return { kind: "failed", text: failText(a.failReason) };
  if (a.phase === "done") {
    const kept = a.timeline.some((t) => t.kind === "report");
    return kept
      ? { kind: "settled", text: "wrote its section" }
      : { kind: "kept", text: "kept what it had" };
  }
  if (a.retry) {
    return {
      kind: "waiting",
      text: `${a.retry.tool.replace(/_/g, " ")} is rate-limited`,
      retryAt: a.retry.retryAt,
    };
  }
  if (a.recovering || liveProse(a, reports) !== null) {
    return { kind: "writing", text: "settling the section into the brief" };
  }
  const lastCall = [...a.timeline].reverse().find((t) => t.kind === "tool_call");
  if (lastCall?.kind === "tool_call" && a.pendingToolCallId === lastCall.id) {
    return { kind: "working", text: `${doing(lastCall.tool)} — ${lastCall.argsSummary}` };
  }
  const lastResult = [...a.timeline].reverse().find((t) => t.kind === "tool_result");
  if (lastResult?.kind === "tool_result") {
    return { kind: "working", text: resultMeta(lastResult) };
  }
  return { kind: "thinking", text: "thinking it through" };
};

export const proseOf = (a: AgentRuntime, reports: Reports): { prose: string | null; streaming: boolean } => {
  const report = [...a.timeline].reverse().find((t) => t.kind === "report");
  if (report?.kind === "report") return { prose: reportBody(report.body, reports.field), streaming: false };
  const live = a.phase !== "done" ? liveProse(a, reports) : null;
  return live ? { prose: live, streaming: true } : { prose: null, streaming: false };
};

/** One step of an inquiry's disclosed stream. `tokens` is the raw tail of
 *  the move being written — visible progress even at a few tokens a second. */
export interface WorkStep {
  kind: "thought" | "call" | "result" | "tokens";
  text: string;
  live: boolean;
}

const stepOf = (t: TimelineItem): WorkStep | null =>
  t.kind === "think" ? { kind: "thought", text: t.body, live: t.live }
  : t.kind === "tool_call" ? { kind: "call", text: `${doing(t.tool)} — ${t.argsSummary}`, live: false }
  : t.kind === "tool_result" ? { kind: "result", text: resultMeta(t), live: false }
  : null;

/** A selector FACTORY for one inquiry's disclosed stream — thoughts as the
 *  fold parsed them, calls and results in the librarian's verbs, and the raw
 *  token tail while the model writes its next move. The report tail is
 *  omitted: it is already streaming in place as the section's prose.
 *
 *  Pure factory: hold the result with `useMemo(() => selectWorkFor(id), [id])`
 *  — `useProjection` memoizes by selector identity, so the caller owns the
 *  identity for exactly as long as the inquiry renders. */
export const selectWorkFor = (id: number): ((app: AppState) => WorkStep[]) => {
  return (app: AppState): WorkStep[] => {
    const a = activeDoc(app).roster.agents.get(id);
    if (!a) return [];
    const steps = a.timeline
      .map(stepOf)
      .filter((s): s is WorkStep => s !== null);
    if (a.phase !== "done" && a.contentBuffer && liveProse(a, handingIn(activeDoc(app))) === null) {
      steps.push({ kind: "tokens", text: a.contentBuffer, live: true });
    }
    return steps;
  };
};
