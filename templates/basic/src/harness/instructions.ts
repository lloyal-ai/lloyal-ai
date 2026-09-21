/** This app's identity, in the model's ear. Two sentences, empty as shipped — fill them and every prompt that
 *  is framed says them, because `framed.eta` puts them around whatever the file itself says. */
export const INSTRUCTIONS = {
  /** Who the app works for and what it helps them do — "You help maintenance engineers investigate equipment
   *  failures." Told to every agent that thinks about the question. */
  purpose: "",
  /** What every answer the reader sees must do — "Lead with the likely cause. Always name the part number."
   *  Told only to whichever agent writes the words the reader gets. */
  answers: "",
};
