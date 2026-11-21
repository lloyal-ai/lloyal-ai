/** The settings dialog's own language: the reader's words for transcription, and nothing else yet. */
import type { AppState } from '../state.js';
import type { LexiconEntry } from '../../protocol.js';

/** Every entry, in the order the reader made them. Empty is a real answer: nothing has been taught yet. */
export const selectLexicon = (app: AppState): readonly LexiconEntry[] => app.session.lexicon;
