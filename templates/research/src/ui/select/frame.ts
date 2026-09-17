/** The Frame moment: the sources being probed, the outline as the planner drafts it, the plan held for the
 *  reader's yes, and the planner's questions. */
import { type AppState } from "../state.js";
import { activeDoc } from "./canvas.js";
import { type Inquiry, doing, resultMeta, verbOf } from "./inquiry.js";
import { selectSources } from "./ask.js";

/** The outline as the planner drafts it, live — complete `"description"`
 *  strings lifted from the grammar-forced JSON stream, plus the trailing
 *  partial under the caret. The planner is the one agent alive while
 *  `planning`; its tokens accumulate in the live think body (the plan
 *  grammar emits no think markers) and the content buffer. */
export interface OutlineDraft {
  settled: string[];
  partial: string | null;
}

const DESC_COMPLETE = /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const DESC_PARTIAL = /"description"\s*:\s*"((?:[^"\\]|\\.)*)$/;
const unescape = (raw: string): string => {
  try { return JSON.parse(`"${raw}"`) as string; } catch { return raw; }
};

export const selectOutlineDraft = (app: AppState): OutlineDraft | null => {
  if (activeDoc(app).phase !== "planning") return null;
  const planner = [...activeDoc(app).roster.agents.values()].find((a) => a.endedAt === null);
  if (!planner) return { settled: [], partial: null };
  const think = planner.timeline.find(
    (t) => t.kind === "think" && t.id === planner.currentThinkId,
  );
  const buffer = (think?.kind === "think" ? think.body : "") + planner.contentBuffer;
  const settled = [...buffer.matchAll(DESC_COMPLETE)].map((m) => unescape(m[1]));
  const tail = buffer.match(DESC_PARTIAL);
  const partial = tail && !settled.includes(unescape(tail[1])) ? unescape(tail[1]) : null;
  return { settled, partial };
};

/** The settled plan, editable while the harness holds it for review. */
export const selectOutline = (app: AppState): string[] =>
  activeDoc(app).plan?.tasks.map((t) => t.description) ?? [];

export const selectReviewing = (app: AppState): boolean =>
  activeDoc(app).phase === "plan_review";

/** The planning round the harness armed; sent back with a yes, an answer or an edit. */
export const selectRevision = (app: AppState): number => activeDoc(app).revision ?? 0;

/** The planner's questions, when it needs the user before framing. */
export const selectClarify = (app: AppState): string[] =>
  activeDoc(app).phase === "clarifying" ? (activeDoc(app).plan?.clarifyQuestions ?? []) : [];

/** One pre-flight probe: a library answering "what do you hold on this?"
 *  before anything is planned. */
export interface Probe {
  title: string;
  inquiry: Inquiry;
  /** Searches the probe has made so far. */
  searches: number;
  /** Results those searches surfaced (null until any land). */
  found: number | null;
  /** The latest visible beat — a thought's title or the last result line —
   *  so the card always shows motion at edge token rates. */
  peek: string | null;
}

/** The pre-flight probes — one recon agent per included library, aligned by
 *  spawn order (the pool forks them in the byline's own order). The Frame
 *  stacks them full-width like every other section; each carries the full
 *  disclosure stream research rows have. */
export const selectProbes = (app: AppState): Probe[] => {
  const included = selectSources(app).filter((l) => l.included);
  const out: Probe[] = [];
  activeDoc(app).reconAgentIds.forEach((id, i) => {
    const a = activeDoc(app).roster.agents.get(id);
    if (!a) return;
    let searches = 0;
    let found: number | null = null;
    for (const t of a.timeline) {
      if (t.kind === "tool_call") searches += 1;
      if (t.kind === "tool_result" && t.resultCount !== null) {
        found = (found ?? 0) + t.resultCount;
      }
    }
    const last = a.timeline[a.timeline.length - 1];
    const peek =
      last === undefined ? null
      : last.kind === "think" ? (last.live && last.title === "Thinking…" ? null : last.title)
      : last.kind === "tool_call" ? `${doing(last.tool)} ${last.argsSummary}`.trim()
      : last.kind === "tool_result" ? resultMeta(last)
      : null;
    out.push({
      title: included[i]?.title ?? "a source",
      inquiry: { id: a.id, index: i, verb: verbOf(a), startedAt: a.startedAt, endedAt: a.endedAt },
      searches,
      found,
      peek,
    });
  });
  return out;
};

/** The Frame moment's recon gate. */
export const selectDiscovering = (app: AppState): boolean =>
  activeDoc(app).phase === "discovering";
