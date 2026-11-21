/**
 * This file is the app: what is installed, what can be configured, and one generator — `harness` — that runs
 * once for each session and lives exactly as long as the session does. Nothing runs at import.
 *
 * To read on, follow `harness`: it puts together the brief (what a reader can do, and what happens when they
 * do), the research the brief is handed (what the model does), and the library (what is kept).
 */
import type { Operation, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import type { EventBus } from "@lloyal-labs/binding";
import { initializeHarness, Services, useExecution, useVideoCommands, useVoiceCommands, serveCommands, serveDefaults } from "@lloyal-labs/rig";
import { settings } from "@lloyal-labs/rig/node";
import { createCorpusAbility } from "@lloyal-labs/corpus-ability";
import { createWebAbility } from "@lloyal-labs/web-ability";
import { createDocumentsAbility } from "@lloyal-labs/documents-ability";
import { config } from "./config.js";
import { briefs } from "./harness/brief.js";
import { openLibrary } from "./harness/library.js";
import type { Command, WorkflowEvent } from "./protocol.js";
import { HarnessExit } from "./protocol.js";
import * as research from "./harness/research.js";
import { openLexicon, replace } from "./user/lexicon.js";
import { fileSettingsStore } from "./user/store.js";
import { lexiconCommands } from "./voice/commands.js";
import { formatTranscript } from "./voice/format.js";

/** What is installed: the sources a brief can draw on. Add one with `npx lloyal-ai install`, then list it here. */
export const abilities = [createCorpusAbility, createWebAbility, createDocumentsAbility];
export { config };

/**
 * One session of the app. `ctx` is the resident model, `events` carries everything the reader is shown, and
 * `commands` brings back everything the reader does. The same generator runs in the terminal, the desktop
 * window and the browser; only what is on the other end of `events` and `commands` differs.
 *
 * It is an Effection operation: read `function*` as `async function` and `yield*` as `await`. What it adds is
 * ownership. Everything started below belongs to this call, and is stopped and cleaned up when the session
 * ends, however it ends — there is no teardown to write here.
 */
export function* harness(ctx: SessionContext, events: EventBus<WorkflowEvent>, commands: Signal<Command, void>): Operation<void> {
  // Starts the agent runtime on the model and enables the abilities. What it sets up is ambient for the rest
  // of the session: code further in asks for it (`useWire()`, `Ctx.expect()`) instead of being handed it.
  // `wire` is the one ordered channel to the view; an ability that could not start is said there.
  const { session, wire, runner, registry, store, disabled } = yield* initializeHarness(ctx, events, { abilities, config });
  for (const { name, reason } of disabled) yield* wire.send({ type: "ui:error", message: `${name} ability disabled: ${reason}` });

  // The reader's own words, from `user.json` beside `harness.yml`. Never the developer's schema: every key in
  // `harness.json` is one `src/config.ts` declared, and nothing here can be — the app did not declare it.
  const problems: string[] = [];
  const lexicon = yield* openLexicon(fileSettingsStore(runner.projectRoot, { onProblem: (problem) => problems.push(problem) }));
  if (problems.length > 0) yield* wire.send({ type: "ui:error", message: "Your words could not be read; transcription starts without them." });
  yield* wire.send({ type: "lexicon:state", entries: [...lexicon.entries()] });

  // The three parts. `run` owns whatever long work is live, one operation at a time: a new one waits for the
  // last one's cleanup, and Stop can always reach what is running.
  const run = yield* useExecution();
  const voice = yield* useVoiceCommands({
    wire,
    // The bias nudges the decoder; the replacement guarantees the spelling. It runs last, after the optional
    // formatting seam, so nothing downstream can undo it.
    transcribe: function* (audio) {
      const asr = (yield* Services.get())?.transcription;
      if (!asr) throw new Error("Transcription is not available.");
      const terms = lexicon.terms();
      const heard = yield* asr.transcribe(audio, terms.length > 0 ? { terms, strength: "hint" } : undefined);
      const shaped = yield* formatTranscript(heard.text);
      return { ...heard, rawText: heard.text, text: replace(lexicon.entries(), shaped).text };
    },
  });
  const video = yield* useVideoCommands({
    wire,
    config: runner.config,   // an attached video, composed from its frames and soundtrack
    bias: () => {
      const terms = lexicon.terms();
      return terms.length > 0 ? { terms, strength: "hint" } : undefined;
    },
    transcript: function* (segment) {
      const shaped = yield* formatTranscript(segment.text);
      return { ...segment, text: replace(lexicon.entries(), shaped).text };
    },
  });
  const library = yield* openLibrary(() => runner.config().sources.outputDir, { events, registry, wire, run, abilities });
  const brief = briefs({ session, library, run, wire, config: runner.config, research });   // hand it another planner or writer here
  yield* wire.send({ type: "weights:done" });   // ready: the model is resident and the abilities are enabled

  if (runner.mode === "oneshot") return yield* once(brief, runner.initialQuery);

  // The loop. Each part brings the commands it handles; one command is handled at a time, and no handler waits
  // for the model — it hands the work to `run` and returns — so a Stop is never stuck behind a long answer.
  // What happens when a handler throws, a command has no handler, or the run can no longer be trusted is rig's
  // (`serveDefaults`); what this app gives up on a failed handler is its own: the run in flight.
  if (runner.initialQuery) yield* brief.submit(runner.initialQuery);
  yield* serveCommands<Command>(commands, [brief, library, voice, video, lexiconCommands({ wire, lexicon }), settings({ runner, registry, store, wire, abilities, config })],
    serveDefaults({ wire, run, abandon: brief.abortRun }));
}

/** A terminal with nobody at it: one question, no plan review, and the brief's outcome is the exit code. */
function* once(brief: ReturnType<typeof briefs>, query: string | undefined): Operation<void> {
  if (!query) throw new HarnessExit("Non-TTY mode requires --query.", 2);
  // `submit` returns as soon as the run is ACCEPTED, and what it returns is the run. The loop above stops
  // there, which is what keeps it free to take a Stop. Nobody can stop this one, so wait for the run as well:
  // it ends once the brief has settled and everything it started has been cleaned up, and its failure is ours.
  const accepted = yield* brief.submit(query, { review: false });
  if (accepted) yield* accepted;
}
