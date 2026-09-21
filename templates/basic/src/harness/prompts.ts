/**
 * Everything the model is told by this app's own hand lives in `prompts/`, one Eta file per text: a prompt is
 * `<name>.system.eta` beside `<name>.user.eta`. Eta reads the folder; nothing here inlines a file, so an edit
 * is live at the next question with no restart.
 *
 * Every system file opens by handing itself to `framed.eta`, the one frame: what the app is FOR is said first
 * (`instructions.ts`) and, for a stage that writes the reader's words, what answers must do is said last.
 */
import { join } from "node:path";
import { Eta } from "eta";
import type { PromptText } from "@lloyal-labs/lloyal-agents";
import { INSTRUCTIONS } from "./instructions.js";

/** The prompts folder, under the project root — which is the working directory, as rig defines it. */
const PROMPTS = join(process.cwd(), "src/harness/prompts");

// The framework renders an ability's own templates with the same syntax and escaping.
// Read files again so edits reach the next question.
const eta = new Eta({ views: PROMPTS, cache: false, autoEscape: false });

type Input = object;

/** One file, rendered with the app's instructions in scope beside `input`. Eta reads the file verbatim, so an
 *  editor's final newline is trimmed here and never reaches the model. */
export const render = (name: string, input: Input = {}): string =>
  eta.render(`${name}.eta`, { ...INSTRUCTIONS, ...input }).trim();

/** A prompt: its system file and its user file, rendered with the same input. */
export const prompt = (name: string, input: Input = {}): PromptText => ({
  systemPrompt: render(`${name}.system`, input),
  content: render(`${name}.user`, input),
});
