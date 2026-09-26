/**
 * Everything the model is told by this app's own hand lives in `prompts/`, one Eta file per text: a prompt is
 * `<name>.system.eta` beside `<name>.user.eta`, and a single turn (the clarify turn) is one file. Eta reads
 * the folder; nothing here inlines a file, so an edit is live at the next run.
 *
 * Every system file opens by handing itself to `framed.eta`, the one frame: what the app is FOR is said
 * first (`instructions.ts`) and, for a stage that writes the reader's answer, what answers must do is said
 * last. `cite.eta` is the citation partial an inquiry includes when its report takes sources.
 *
 * What a prompt is rendered with is what the caller knows: the framework hands the app what only it knows
 * (a reaped agent's word budget) through `PromptOf`, and the app adds its own.
 */
import { join } from "node:path";
import { Eta } from "eta";
import { guardedInput } from "@lloyal-labs/lloyal-agents";
import type { MissingInput, PromptText } from "@lloyal-labs/lloyal-agents";
import { INSTRUCTIONS } from "./instructions.js";

/** The prompts folder, under the project root — which is the working directory, as rig defines it. */
export const PROMPTS = join(process.cwd(), "src/harness/prompts");

// The framework renders an ability's own templates with the same syntax and escaping.
// Read files again so edits reach the next question.
const eta = new Eta({ views: PROMPTS, cache: false, autoEscape: false });

type Input = object;

/** What a missing input does while nobody watches: a line in the engine's log, and the run goes on. */
const warn = ({ prompt, key }: MissingInput): void => { console.warn(`[prompts] ${prompt}: input "${key}" is not given — rendered empty`); };
let watching: (miss: MissingInput) => void = warn;

// Every render Eta makes — the file asked for, the frame it hands itself to, a partial it includes — reads its
// input through the guard: a key the file reads that was not given is reported and rendered empty, never the
// word "undefined" in what the model reads. Wrapped on the instance, since a layout and a partial each render
// through it with a copy of the input.
const bare = eta.render.bind(eta);
eta.render = ((template: string, data: object, meta?: { filepath: string }): string =>
  bare(template, guardedInput(template, (data ?? {}) as Record<string, unknown>, (m) => watching(m)), meta)) as typeof eta.render;

/** One file, rendered with the app's instructions in scope beside `input`. Eta reads the file verbatim, so an
 *  editor's final newline is trimmed here and never reaches the model. (The extension is spelled out: Eta
 *  infers one from the last dot, and `plan.system` already has a dot.) */
export const render = (name: string, input: Input = {}, opts: { onMissing?: (miss: MissingInput) => void } = {}): string => {
  const prior = watching;
  watching = opts.onMissing ?? warn;
  try { return eta.render(`${name}.eta`, { ...INSTRUCTIONS, ...input }).trim(); } finally { watching = prior; }
};

/** A prompt: its system file and its user file, rendered with the same input. */
export const prompt = (name: string, input: Input = {}): PromptText => ({
  systemPrompt: render(`${name}.system`, input),
  content: render(`${name}.user`, input),
});
