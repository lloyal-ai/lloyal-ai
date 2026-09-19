/** The Settle moment: the answer, the sources it cites, the marks in its margin, and the follow-ups threaded
 *  beneath it. */
import { type AppState, type AgentRuntime, type DocState } from "../state.js";
import { hostOf } from "@lloyal-labs/ui/fold";
import { linksOf } from "@lloyal-labs/ui/prose";
import { type Answer, activeDoc } from "./canvas.js";
import { type Inquiry, currentAttempts, handingIn, liveProse, timelineOf, verbOf } from "./inquiry.js";

/** What the settling agent has deliberated and written, read off its timeline: its think block, then the
 *  answer — filed as its report once it has returned, streaming in its content buffer until then. Null before
 *  it has spawned, and for a document whose roster no longer holds it. */
export const settlingOf = (d: DocState): Answer | null => {
  const a = d.synth.agentId !== null ? d.roster.agents.get(d.synth.agentId) : undefined;
  if (!a) return null;
  const thought = timelineOf(a).find((t) => t.kind === "think");
  const report = timelineOf(a).find((t) => t.kind === "report");
  return {
    thinking: thought?.kind === "think" && thought.body ? thought.body : null,
    body: report?.kind === "report" ? report.body : a.contentBuffer,
    streaming: report === undefined,
  };
};

/** The answer as it exists right now: the settling pass as it writes, else the settled text — with the
 *  deliberation behind it for as long as the roster holds the agent that wrote it. Deliberately NOT
 *  scrollback — the session scrollback outlives the document, and reading it here would let one brief's prose
 *  render under another's title. */
export const selectAnswer = (app: AppState): Answer | null => {
  const d = activeDoc(app);
  const settling = settlingOf(d);
  if (d.synth.open && settling) return settling;
  return d.answer !== null ? { thinking: settling?.thinking ?? null, body: d.answer, streaming: false } : null;
};

export interface Citation {
  ordinal: number;
  title: string;
  url: string;
  host: string;
  cited: number;
}

/** A link whose whole text is its number — "[1]", "1" — the weave's bare citation, which shows as the chip alone. */
export const isBareOrdinal = (text: string): boolean => /^\[?\d+\]?$/.test(text.trim());

/** A target that is not a url is a corpus file's path: the chip says where it came from. */
const hostOrCorpus = (url: string): string => (URL.canParse(url) ? hostOf(url) : "your corpus");

/** Numbered chips, derived from the woven answer alone — every link the renderer draws, in first-appearance
 *  order, one ordinal per target, repeats collapsed into `cited`; web urls and corpus file paths alike. A bare
 *  "[1]"-style link keeps its slot but takes a real title from any later appearance. A link the renderer
 *  strips (an unsafe scheme) is no citation. Never re-weaves. */
/** One answer body, one citations array: a view that hands `Prose` a Map built
 *  from this list must get the SAME list while the answer stands, or the settled
 *  prose re-parses on every token of a warm ask beneath it. A projection keeps a
 *  result per state; this keeps it per body. */
let lastCitations: { body: string; citations: Citation[] } | null = null;

export const selectCitations = (app: AppState): Citation[] => {
  const body = selectAnswer(app)?.body ?? "";
  if (lastCitations !== null && lastCitations.body === body) return lastCitations.citations;
  const citations = citationsOf(body);
  lastCitations = { body, citations };
  return citations;
};

const citationsOf = (body: string): Citation[] => {
  const byUrl = new Map<string, Citation>();
  for (const { href: url, text: title } of linksOf(body)) {
    if (!url) continue;
    const seen = byUrl.get(url);
    if (seen) {
      seen.cited += 1;
      if (isBareOrdinal(seen.title) && !isBareOrdinal(title)) seen.title = title;
      continue;
    }
    byUrl.set(url, { ordinal: byUrl.size + 1, title, url, host: hostOrCorpus(url), cited: 1 });
  }
  return [...byUrl.values()];
};

/** A list line: an optional bullet or number, then a markdown link, then whatever follows on the line. */
const LINK_LINE = /^\s*(?:[-*]|\d+\.)?\s*\[[^\]]*\]\([^)]*\)/;
/** The heading that names the list: "Sources", "References", plain, bold or a markdown heading, with or without a colon. */
const SOURCES_HEAD = /^(?:#{1,4}\s+|\*\*)?(?:sources|references)(?:\*\*)?\s*:?$/i;

/** The weave (and the synth) end the document with a bare source list —
 *  the sources grid replaces it, so the prose sheds it. Read from the end a
 *  line at a time — the list's lines, then the heading that names them — so
 *  the cost is the body's length; anything not of that shape is left alone.
 *  (A regex for the same shape backtracked without bound on a reference list
 *  followed by more text, and pinned the tab on every open of such a brief.) */
export const shedTrailingSources = (body: string): string => {
  const lines = body.split("\n");
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  let i = end;
  let links = 0;
  while (i > 0 && (LINK_LINE.test(lines[i - 1]) || (links > 0 && lines[i - 1].trim() === ""))) {
    if (lines[i - 1].trim() !== "") links++;
    i--;
  }
  if (links === 0) return body.trimEnd();
  while (i > 0 && lines[i - 1].trim() === "") i--;
  // The heading needs a line above it: a list opening the body is the body, not a trailer.
  if (i < 2 || !SOURCES_HEAD.test(lines[i - 1].trim())) return body.trimEnd();
  return lines.slice(0, i - 1).join("\n").trimEnd();
};

export const selectSettleProse = (app: AppState): string =>
  shedTrailingSources(selectAnswer(app)?.body ?? "");

/** Structural margin marks — facts of the run, never judgments of the
 *  content: how it ended, how much it rests on, what closed unsettled. */
export const selectMarks = (app: AppState): string[] => {
  const marks: string[] = [];
  if (activeDoc(app).closedEarly) marks.push("Closed early — settled with what it had.");
  const cited = selectCitations(app).length;
  if (cited === 1) marks.push("Rests on one source — read it before you lean on it.");
  else if (cited === 2) marks.push("Rests on two sources.");
  // A line of inquiry, not an attempt at one: a task whose latest attempt failed closed unsettled, and a task
  // that failed once and was healed did not.
  let unsettled = 0;
  for (const a of currentAttempts(activeDoc(app)).values()) if (a.failReason !== null) unsettled += 1;
  if (unsettled === 1) marks.push("One line of inquiry closed without settling.");
  else if (unsettled > 1) marks.push(`${unsettled} lines of inquiry closed without settling.`);
  return marks;
};

/** The document's warm-ask exchanges, settled beneath it. */
export const selectExchanges = (app: AppState): DocState["exchanges"] => activeDoc(app).exchanges;

/** The warm ask in flight: its question, whatever of its answer has
 *  streamed, and its worker as a full inquiry — verbs, park honesty, and
 *  the disclosure — numbered after the document's own inquiries. */
export const selectAsk = (
  app: AppState,
): { question: string; body: string; inquiry: Inquiry | null; attachments: string[] } | null => {
  const d = activeDoc(app);
  if (d.ask === null) return null;
  const index = (d.plan?.tasks.length ?? 0) + d.exchanges.length;
  for (const a of d.roster.agents.values()) {
    if (a.endedAt === null) {
      return {
        question: d.ask,
        attachments: d.askAttachments,
        body: liveProse(a, handingIn(d)) ?? "",
        inquiry: { id: a.id, index, verb: verbOf(a, handingIn(d)), startedAt: a.startedAt, endedAt: a.endedAt },
      };
    }
  }
  return { question: d.ask, body: "", inquiry: null, attachments: d.askAttachments };
};

/** What the run itself read about each source: the first snippet any tool
 *  result carried for a url, for the source cards. */
export const selectSourceNotes = (app: AppState): Map<string, string> => {
  const notes = new Map<string, string>();
  const harvest = (a: AgentRuntime): void => {
    for (const t of timelineOf(a)) {
      if (t.kind !== "tool_result" || !t.sources) continue;
      for (const s of t.sources) {
        if (s.url && s.snippet && !notes.has(s.url)) notes.set(s.url, s.snippet);
      }
    }
  };
  for (const a of activeDoc(app).roster.agents.values()) harvest(a);
  return notes;
};
