/** The Settle moment: the answer, the sources it cites, the marks in its margin, and the follow-ups threaded
 *  beneath it. */
import { type AppState, type AgentRuntime } from "../state.js";
import { type Answer, activeDoc, splitThink } from "./canvas.js";
import { type Inquiry, currentAttempts, handingIn, liveProse, verbOf } from "./inquiry.js";

/** The answer as it exists right now: the live synth stream, else the
 *  finalized text. Deliberately NOT scrollback — the session scrollback
 *  outlives the document, and reading it here would let one brief's prose
 *  render under another's title. */
export const selectAnswer = (app: AppState): Answer | null => {
  const d = activeDoc(app);
  if (d.synth.open && d.synth.buffer) {
    return { ...splitThink(d.synth.buffer, true), streaming: true };
  }
  return d.answer !== null ? { ...splitThink(d.answer, false), streaming: false } : null;
};

export interface Citation {
  ordinal: number;
  title: string;
  url: string;
  host: string;
  cited: number;
}

// Any link target counts as a citation — a report's woven sources cite web urls and
// corpus file paths alike; a non-url target IS a corpus file.
const MD_LINK = /\[([^\]]+)\]\(([^\s)]+)\)/g;
const BARE_ORDINAL = /^\[?\d+\]?$/;

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "your corpus"; }
};

/** Numbered chips, derived from the woven answer alone — links in first-
 *  appearance order, one ordinal per url, repeats collapsed into `cited`.
 *  A bare "[1]"-style link keeps its slot but takes a real title from any
 *  later appearance. Never re-weaves. */
export const selectCitations = (app: AppState): Citation[] => {
  const body = selectAnswer(app)?.body ?? "";
  const byUrl = new Map<string, Citation>();
  for (const m of body.matchAll(MD_LINK)) {
    const [, title, url] = m;
    const seen = byUrl.get(url);
    if (seen) {
      seen.cited += 1;
      if (BARE_ORDINAL.test(seen.title) && !BARE_ORDINAL.test(title)) seen.title = title;
      continue;
    }
    byUrl.set(url, { ordinal: byUrl.size + 1, title, url, host: hostOf(url), cited: 1 });
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
/** Exchanges parsed the way the root answer is: deliberation split out behind
 *  its own disclosure, prose alone in the document. The fold keeps the RAW
 *  stream (the host is the author); the split is a view concern. */
export const selectExchanges = (
  app: AppState,
): { question: string; body: string; thinking: string | null; attachments: string[] }[] =>
  activeDoc(app).exchanges.map((x) => ({ question: x.question, attachments: x.attachments, ...splitThink(x.body, false) }));

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
        // While the think block is open the text is deliberation, never answer
        // prose — the row's verb already says "thinking it through".
        body: splitThink(liveProse(a, handingIn(d)) ?? "", true).body,
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
    for (const t of a.timeline) {
      if (t.kind !== "tool_result" || !t.sources) continue;
      for (const s of t.sources) {
        if (s.url && s.snippet && !notes.has(s.url)) notes.set(s.url, s.snippet);
      }
    }
  };
  for (const a of activeDoc(app).roster.agents.values()) harvest(a);
  return notes;
};
