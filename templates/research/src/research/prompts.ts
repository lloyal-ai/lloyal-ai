/**
 * Everything the model is told by this app's own hand: the prompt files beside this one, and the few single
 * sentences that need no file. (What the app is FOR is yours to say, in `instructions.ts`.)
 *
 * Each `.eta` file is a system prompt, a `---` line, and a user template rendered with Eta. They are inlined as
 * text when the engine is bundled, so nothing here reads a file — and an edit needs the dev command restarted.
 */
import PLAN_RAW from "./prompts/plan.eta";
import PLAN_FLAT_RAW from "./prompts/plan-flat.eta";
import PREFLIGHT_RAW from "./prompts/preflight.eta";
import PREFLIGHT_RECOVER_RAW from "./prompts/preflight-recover.eta";
import RECOVERY_RAW from "./prompts/recovery.eta";
import SYNTHESIZE_RAW from "./prompts/synthesize.eta";
import SYNTHESIZE_FLAT_RAW from "./prompts/synthesize-flat.eta";

export type Prompt = { system: string; user: string };

function parse(raw: string): Prompt {
  const trimmed = raw.trim();
  const sep = trimmed.indexOf("\n---\n");
  if (sep === -1) return { system: trimmed, user: "" };
  return { system: trimmed.slice(0, sep).trim(), user: trimmed.slice(sep + 5).trim() };
}

/** The single sentences. */
export const WORDS = {
  /** The report's grammar forces the SHAPE of its `sources`; this nudges their CONTENT toward real URLs and inline
   *  citations. Said of whichever tool the inquiry hands its findings through. */
  citationNudge: (tool: string): string =>
    `\n\nWhen you call ${tool}(): cite each claim inline as [title](url) using the exact URL from tool results, and fill the sources field with every {title, url} you used (real URLs from tool results, not file paths). A document page's \`cite\` value (attachment://…/page/N) is such a URL — use it as-is for every page you quote.`,
  /** Said once to an inquiry that reports before it has looked anything up. */
  evidenceFloor: "You must use tools before submitting results.",
  /** How an investigation's next task is put to the spine. */
  researchTask: (description: string): string => `Research task: ${description}`,
  /** The planner's questions as the assistant's turn, so the next planner fork attends the whole dialogue. */
  clarifyTurn: (questions: readonly string[]): string =>
    ["I need to clarify a few things before researching:", "", ...questions.map((q, i) => `${i + 1}. ${q}`)].join("\n"),
} as const;

/** A prompt said of one tool: `it.tool` is this app's and is rendered here, now; `it.budget` is the framework's and
 *  is rendered when a reaped agent is given the turn, so it stays. */
export const forTool = (p: Prompt, tool: string): Prompt =>
  ({ system: p.system.replaceAll("<%= it.tool %>", tool), user: p.user.replaceAll("<%= it.tool %>", tool) });

export const PROMPTS = {
  plan: parse(PLAN_RAW),
  planFlat: parse(PLAN_FLAT_RAW),
  preflight: parse(PREFLIGHT_RAW),
  preflightRecover: parse(PREFLIGHT_RECOVER_RAW),
  recovery: parse(RECOVERY_RAW),
  synthesize: parse(SYNTHESIZE_RAW),
  synthesizeFlat: parse(SYNTHESIZE_FLAT_RAW),
} as const;
