/**
 * The reader's edits to the lexicon, and the fact they produce.
 *
 * Two commands rather than one `set_lexicon`: an add and a remove name exactly what changed, so two edits
 * arriving in one session cannot clobber each other, and the store never writes a list the reader did not
 * make. Every change answers with the whole list — the view folds it, never a delta.
 *
 * @module
 */
import type { Operation } from 'effection';
import type { CommandGroup } from '@lloyal-labs/rig';
import type { LexiconCommand, LexiconEvent } from '../protocol.js';
import type { Lexicon } from '../user/lexicon.js';

export function lexiconCommands({ wire, lexicon }: {
  wire: { send(event: LexiconEvent): Operation<void> };
  lexicon: Lexicon;
}): CommandGroup<LexiconCommand> {
  const publish = function* (): Operation<void> {
    yield* wire.send({ type: 'lexicon:state', entries: [...lexicon.entries()] });
  };
  return {
    handlers: {
      *add_lexicon_term({ term, heardAs }) {
        yield* lexicon.add(term, heardAs);
        yield* publish();
      },
      *remove_lexicon_term({ term }) {
        yield* lexicon.remove(term);
        yield* publish();
      },
    },
  };
}
