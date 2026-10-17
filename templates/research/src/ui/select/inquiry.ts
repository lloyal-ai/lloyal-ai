/** One agent's work, in the reader's language: what it is doing right now, the prose it has written so far,
 *  and the whole stream of its work for anyone who opens it. Every moment that shows an agent reads it here. */
import { extractStreamingReport, type AppState, type DocState, type AgentRuntime, type TimelineItem } from "../state.js";
import { RIG_REPORT, type Reports } from "@lloyal-labs/rig";
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

/** Failure, in the librarian's voice: the inquiry ended with nothing kept. Unlisted reasons are mechanical
 *  (decode errors) — the dev pane keeps the detail. */
const FAIL_TEXT: Record<string, string> = {
  user_cancel: "dropped — left out of the brief",
};
const failText = (reason: string): string =>
  FAIL_TEXT[reason] ?? "couldn't finish this line of inquiry";

/** Why a span ended before the inquiry finished on its own, in the reader's words — the drop reason
 *  `agent:done` carried. "Failed", to the reader, is not getting a normal round; what was kept is still kept. */
const STOP_TEXT: Record<string, string> = {
  pressure_critical: "ran out of room",
  pressure_settle_reject: "ran out of room",
  settle_stall_break: "ran out of room",
  pressure_softcut: "ran out of room",
  policy_exit: "out of time",
  wind_down: "closed early",
  terminal_cap: "reached the report length",
  maxTurns: "used its turns",
  reader_stop: "stopped by you",
};
const stopText = (reason: string | null): string =>
  (reason !== null ? STOP_TEXT[reason] : undefined) ?? "stopped before it finished";

/** The reader stopped the run: nothing more will come, so what was written is all there is. */
const stoppedByReader = (a: AgentRuntime): boolean => a.stopReason === "reader_stop";

/** The span ended early: a reason was given, or a draft was left behind. */
const stoppedEarly = (a: AgentRuntime): boolean => a.stopReason !== null || a.draft !== null;

/** The report the draft held, if the model was writing one when it was stopped — read the way the live stream
 *  is read, so the draft and what was kept are compared like for like. A call it was mid-way through is no draft. */
const draftProseOf = (a: AgentRuntime, reports: Reports): string | null =>
  a.draft === null || reports.field === null ? null : extractStreamingReport(a.draft, { tool: reports.tool, field: reports.field });

/** An agent's timeline; an agent tracked by its numbers only has none, and reads as one with nothing in it. */
export const timelineOf = (a: AgentRuntime): readonly TimelineItem[] => a.timeline ?? [];

export const verbOf = (a: AgentRuntime, reports: Reports): InquiryVerb => {
  if (a.failReason) return { kind: "failed", text: failText(a.failReason) };
  if (a.phase === "done") {
    const kept = timelineOf(a).some((t) => t.kind === "report");
    if (!kept && stoppedByReader(a)) {
      return { kind: "kept", text: draftProseOf(a, reports) !== null ? "stopped by you — kept to here" : "stopped by you" };
    }
    if (!kept) return { kind: "kept", text: "kept what it had" };
    if (!stoppedEarly(a)) return { kind: "settled", text: "wrote its section" };
    const held = a.stopReason === "terminal_cap" ? "kept to here" : "kept what it had";
    return { kind: "kept", text: `${stopText(a.stopReason)} — ${held}` };
  }
  if (a.retry) {
    return {
      kind: "waiting",
      text: `${a.retry.tool.replace(/_/g, " ")} is rate-limited`,
      retryAt: a.retry.retryAt,
    };
  }
  // Dropped, and recovering what it found: the recovery's report arrives whole at its end, up to a minute
  // later, so until then the section says what is happening rather than that prose is settling.
  if (a.recovering) return { kind: "writing", text: `${stopText(a.stopReason)} — recovering what it found…` };
  if (liveProse(a, reports) !== null) {
    const writing = "settling the section into the brief";
    return { kind: "writing", text: stoppedEarly(a) ? `${stopText(a.stopReason)} — ${writing}` : writing };
  }
  const lastCall = [...timelineOf(a)].reverse().find((t) => t.kind === "tool_call");
  if (lastCall?.kind === "tool_call" && a.pendingToolCallId === lastCall.id) {
    return { kind: "working", text: `${doing(lastCall.tool)} — ${lastCall.argsSummary}` };
  }
  const lastResult = [...timelineOf(a)].reverse().find((t) => t.kind === "tool_result");
  if (lastResult?.kind === "tool_result") {
    return { kind: "working", text: resultMeta(lastResult) };
  }
  return { kind: "thinking", text: "thinking it through" };
};

/** A stop shown where the text is: the note for the rule, and the words beyond what was kept, if any. */
export interface Stopped {
  note: string;
  /** What streamed past the kept text — shown as plain text, never as markdown, so a cut inside a table or a
   *  fence cannot leak into what follows. Null when nothing was lost, or when the kept text is no prefix. */
  tail: string | null;
}

export interface SectionProse {
  prose: string | null;
  streaming: boolean;
  /** A report the inquiry was writing when it was stopped, frozen above the rule while its write-up streams. */
  draft: string | null;
  stopped: Stopped | null;
}

const NOTHING: SectionProse = { prose: null, streaming: false, draft: null, stopped: null };

export const proseOf = (a: AgentRuntime, reports: Reports): SectionProse => {
  const report = [...timelineOf(a)].reverse().find((t) => t.kind === "report");
  const draft = draftProseOf(a, reports);
  const cause = stopText(a.stopReason);
  if (report?.kind === "report") {
    const prose = reportBody(report.body, reports.field);
    if (draft === null) return { prose, streaming: false, draft: null, stopped: null };
    // What was kept is a prefix of what streamed (a salvage); the rest is shown, not dropped on the quiet. A kept
    // text that is no prefix may be the draft woven with its citations, or a write-up that replaced it; the rule
    // cannot tell them apart and says only what is certain.
    if (!draft.startsWith(prose)) return { prose, streaming: false, draft: null, stopped: { note: `${cause} — kept what it had`, tail: null } };
    const beyond = draft.slice(prose.length);
    return { prose, streaming: false, draft: null, stopped: { note: `${cause} — kept to here`, tail: beyond.length > 0 ? beyond : null } };
  }
  if (a.failReason !== null) {
    return draft === null ? NOTHING : { prose: null, streaming: false, draft: null, stopped: { note: `${cause} — nothing could be kept`, tail: draft } };
  }
  // Stopped by the reader mid-report: the draft is the section, under the rule; no write-up will follow.
  if (stoppedByReader(a)) {
    return draft === null ? NOTHING : { prose: draft, streaming: false, draft: null, stopped: { note: `${cause} — kept to here`, tail: null } };
  }
  const live = a.phase !== "done" ? liveProse(a, reports) : null;
  return {
    prose: live,
    streaming: live !== null,
    draft,
    stopped: draft === null ? null : { note: `${cause} — writing up what it found`, tail: null },
  };
};

/** The one line the disclosed stream shows for an early stop. */
export const stopStep = (a: AgentRuntime): string | null =>
  stoppedEarly(a) ? `stopped — ${stopText(a.stopReason)}` : null;

/** One step of an inquiry's disclosed stream. `tokens` is the raw tail of
 *  the move being written — visible progress even at a few tokens a second. */
export interface WorkStep {
  kind: "thought" | "call" | "result" | "tokens" | "stopped";
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
    const steps = timelineOf(a)
      .map(stepOf)
      .filter((s): s is WorkStep => s !== null);
    const stop = stopStep(a);
    if (stop !== null) steps.push({ kind: "stopped", text: stop, live: false });
    if (a.phase !== "done" && a.contentBuffer && liveProse(a, handingIn(activeDoc(app))) === null) {
      steps.push({ kind: "tokens", text: a.contentBuffer, live: true });
    }
    return steps;
  };
};
