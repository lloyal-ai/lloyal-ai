/**
 * The reader's words for transcription, and the two things they do.
 *
 * A word is **declared** to the decoder as a bias — "these words matter" — and **replaced** after it, which is
 * the guarantee: a bias moves the model's distribution, and for a made-up name the audio is ambiguous, so the
 * decoder can still write the wrong spelling. The replacement is deterministic and terminal, which is why
 * nothing downstream can undo it.
 *
 * A term's `heardAs` are the spellings speech recognition has produced for it. The list stays short because
 * the bias does most of the work; the replacement covers what it misses.
 *
 * @module
 */
import type { Operation } from 'effection';
import type { LexiconEntry } from '../protocol.js';
import type { SettingsStore } from './store.js';

export interface Lexicon {
  /** Every entry, in the order the reader made them. */
  entries(): readonly LexiconEntry[];
  /** The terms alone — what the decoder is biased with. */
  terms(): readonly string[];
  /** Add or merge one. An empty term is refused; a term already known keeps its place and grows its list. */
  add(term: string, heardAs?: readonly string[]): Operation<void>;
  /** Remove by term, whatever its case. */
  remove(term: string): Operation<void>;
}

/** The lexicon this session reads and edits, over the installation's `user.json`. */
export function* openLexicon(store: SettingsStore): Operation<Lexicon> {
  let settings = yield* store.read();
  const entries = (): readonly LexiconEntry[] => settings.transcription.entries;
  const save = function* (next: readonly LexiconEntry[]): Operation<void> {
    settings = { ...settings, transcription: { entries: [...next] } };
    yield* store.set(settings);
  };
  return {
    entries,
    terms: () => entries().map((entry) => entry.term),
    *add(term, heardAs) {
      const clean = term.trim();
      if (!clean) return;
      const heard = merge([], heardAs ?? []);
      const at = entries().findIndex((entry) => entry.term.toLowerCase() === clean.toLowerCase());
      const next = at < 0
        ? [...entries(), { term: clean, ...(heard.length > 0 ? { heardAs: heard } : {}) }]
        : entries().map((entry, i) => {
            if (i !== at) return entry;
            const merged = merge(entry.heardAs ?? [], heard);
            return merged.length > 0 ? { ...entry, heardAs: merged } : { term: entry.term };
          });
      yield* save(next);
    },
    *remove(term) {
      const clean = term.trim().toLowerCase();
      yield* save(entries().filter((entry) => entry.term.toLowerCase() !== clean));
    },
  };
}

/** What a transcribed text becomes once every heard spelling is its term. `replaced` counts the places
 *  changed, so a record can say what the dictionary did without ever keeping the text. */
export function replace(entries: readonly LexiconEntry[], text: string): { text: string; replaced: number } {
  const pairs = entries.flatMap((entry) =>
    (entry.heardAs ?? [])
      .map((heard) => ({ heard: heard.trim(), term: entry.term.trim() }))
      .filter(({ heard, term }) => heard !== '' && term !== '' && heard !== term));
  // A longer spelling first: "l oil" before "oil", so the phrase wins over its own last word.
  pairs.sort((a, b) => b.heard.length - a.heard.length);
  let replaced = 0;
  let out = text;
  for (const { heard, term } of pairs) {
    out = out.replace(phrase(heard), () => {
      replaced++;
      return term;
    });
  }
  return { text: out, replaced };
}

/** A whole phrase, never part of a longer word: the lookarounds keep "loyal" out of "loyalty". */
function phrase(heard: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(heard)}(?![\\p{L}\\p{N}_])`, 'giu');
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The spellings in order, once each, whatever their case. */
function merge(into: readonly string[], more: readonly string[]): string[] {
  const out = [...into];
  for (const raw of more) {
    const heard = raw.trim();
    if (!heard) continue;
    if (out.some((known) => known.toLowerCase() === heard.toLowerCase())) continue;
    out.push(heard);
  }
  return out;
}
