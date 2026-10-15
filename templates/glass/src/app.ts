import type { Operation, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import type { EventBus } from "@lloyal-labs/binding";
import {
  initializeHarness,
  useExecution,
  useVoiceCommands,
  serveCommands,
  serveDefaults,
  HarnessExit,
} from "@lloyal-labs/rig";
import { settings } from "@lloyal-labs/rig/node";
import { createCorpusAbility } from "@lloyal-labs/corpus-ability";
import { createWebAbility } from "@lloyal-labs/web-ability";
import { createDocumentsAbility } from "@lloyal-labs/documents-ability";
import { createWikipediaAbility } from "@lloyal-labs/wikipedia-ability";
import { config } from "./config.js";
import { conversations } from "./harness/conversations.js";
import type { Command, WorkflowEvent } from "./protocol.js";

export const abilities = [
  createCorpusAbility,
  createWebAbility,
  createDocumentsAbility,
  createWikipediaAbility,
];
export { config };
export function* harness(
  ctx: SessionContext,
  events: EventBus<WorkflowEvent>,
  commands: Signal<Command, void>,
): Operation<void> {
  const { session, wire, runner, registry, store, disabled } =
    yield* initializeHarness(ctx, events, { abilities, config });
  for (const { name, reason } of disabled)
    yield* wire.send({ type: "ui:error", message: `${name}: ${reason}` });
  const run = yield* useExecution();
  const voice = yield* useVoiceCommands({ wire });
  const conversation = yield* conversations({
    session,
    wire,
    run,
    events,
    root: runner.config().sources.outputDir,
  });
  yield* wire.send({ type: "weights:done" });
  if (runner.mode === "oneshot") {
    if (!runner.initialQuery)
      throw new HarnessExit("Provide --query for a non-interactive run.", 2);
    const accepted = yield* conversation.submit(runner.initialQuery);
    return yield* accepted;
  }
  if (runner.initialQuery) yield* conversation.submit(runner.initialQuery);
  yield* serveCommands<Command>(
    commands,
    [
      conversation,
      voice,
      settings({ runner, registry, store, wire, abilities, config }),
    ],
    serveDefaults({ wire, run }),
  );
}
