/**
 * The optional shaping pass between transcription and the lexicon's replacement.
 *
 * Identity today: Qwen3-ASR already decodes punctuation and capitalisation, and does not emit fillers, so
 * there is nothing to shape yet. It is a seam, not a step — the place a spoken list, a spoken punctuation
 * mark or an optional model cleanup would go.
 *
 * **It may change LAYOUT, never words.** The replacement that follows matches on words, so a pass that
 * rewrites them would silently move the ground under the dictionary. It also runs *before* the replacement,
 * never after: the deterministic layer has the last word on names, which is why no name guard is needed.
 *
 * @module
 */
import type { Operation } from 'effection';

export function* formatTranscript(text: string): Operation<string> {
  return text;
}
