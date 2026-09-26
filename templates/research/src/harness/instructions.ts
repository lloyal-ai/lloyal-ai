/**
 * What this application is for, in the model's hearing. Two sentences of yours, said on every path an answer can
 * take, so the app is the same app whether the reader asked a direct question, followed up on a settled brief, or
 * set off a planned investigation. `prompts/framed.eta` says them: the purpose before every system prompt, and
 * what answers must do after the ones that write the reader's answer.
 *
 * Both are empty as shipped, and an empty one adds nothing to any prompt. Instructions are read when a run
 * starts: restart the dev command after editing them, and ask a fresh question.
 */
export const INSTRUCTIONS = {
  /** Who the app works for and what it helps them do — "You help maintenance engineers investigate equipment
   *  failures." Told to every agent that thinks about the question: the planner, each inquiry, a direct or warm
   *  answer, the settling pass, and an inquiry cut short and asked to report. */
  purpose: "",
  /** What every answer the reader sees must do — "Lead with the likely cause. Always name the part number."
   *  Told only to whichever agent writes the words the reader gets: the settling pass, a lone inquiry, a direct
   *  or warm answer. The planner never hears it: its output is a plan, in the plan's own format. */
  answers: "",
};

