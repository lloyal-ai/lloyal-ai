/** The Frame moment: the sources being probed, the outline as the planner drafts it, the plan held for the
 *  reader's yes, and the planner's questions. */
import { Allow, MalformedJSON, parse } from "partial-json";
import { type AppState } from "../state.js";
import { activeDoc } from "./canvas.js";
import { type Inquiry, doing, handingIn, resultMeta, timelineOf, verbOf } from "./inquiry.js";

/** The outline as the planner drafts it, live: the tasks whose descriptions are complete, and the one still
 *  being written under the caret. The planner is the one agent alive while `planning`; its grammar-forced JSON
 *  accumulates in its content buffer. */
export interface OutlineDraft {
  settled: string[];
  partial: string | null;
}

/** The plan so far, read from a JSON document that is still being written. `Allow.ALL` keeps a string cut
 *  mid-way (the task under the caret); without `STR` that pair is dropped, so the two reads differ by exactly
 *  the description still being written. A draft that is not JSON yet — or begins with a code fence, which the
 *  planner's few-shot examples prime — is read from its first brace; nothing readable is an empty outline. */
const tasksOf = (draft: string, allow: number): string[] => {
  const from = draft.indexOf("{");
  if (from === -1) return [];
  try {
    const plan = parse(draft.slice(from), allow) as { tasks?: { description?: unknown }[] };
    return (plan.tasks ?? []).map((t) => t.description).filter((d): d is string => typeof d === "string");
  } catch (err) {
    if (err instanceof MalformedJSON) return [];
    throw err;
  }
};

export const selectOutlineDraft = (app: AppState): OutlineDraft | null => {
  if (activeDoc(app).phase !== "planning") return null;
  const planner = [...activeDoc(app).roster.agents.values()].find((a) => a.endedAt === null);
  if (!planner) return { settled: [], partial: null };
  const settled = tasksOf(planner.contentBuffer, Allow.ALL & ~Allow.STR);
  const partial = tasksOf(planner.contentBuffer, Allow.ALL)[settled.length] ?? null;
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

/** The pre-flight probes — one agent per source that takes part, each wearing the name of the source its spawn
 *  named (the byline's order says nothing: the pool seats probes as the context allows). The Frame stacks them
 *  full-width like every other section; each carries the full disclosure stream research rows have. */
export const selectProbes = (app: AppState): Probe[] => {
  const out: Probe[] = [];
  activeDoc(app).reconAgentIds.forEach((id, i) => {
    const a = activeDoc(app).roster.agents.get(id);
    if (!a) return;
    let searches = 0;
    let found: number | null = null;
    const items = timelineOf(a);
    for (const t of items) {
      if (t.kind === "tool_call") searches += 1;
      if (t.kind === "tool_result" && t.resultCount !== null) {
        found = (found ?? 0) + t.resultCount;
      }
    }
    const last = items[items.length - 1];
    const peek =
      last === undefined ? null
      : last.kind === "think" ? (last.live && last.title === "Thinking…" ? null : last.title)
      : last.kind === "tool_call" ? `${doing(last.tool)} ${last.argsSummary}`.trim()
      : last.kind === "tool_result" ? resultMeta(last)
      : null;
    out.push({
      title: a.taskDescription ?? "a source",
      inquiry: { id: a.id, index: i, verb: verbOf(a, handingIn(activeDoc(app))), startedAt: a.startedAt, endedAt: a.endedAt },
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
