/** What this app is: what is installed, what it reads, and how its parts are put together. Nothing runs at import. */
import type { Operation, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import type { EventBus } from "@lloyal-labs/binding";
import { isGuardOverrides } from "@lloyal-labs/lloyal-agents";
import { defineConfig, modelSettings, initializeHarness, useExecution, serveCommands } from "@lloyal-labs/rig";
import type { ConfigOf, OriginOf } from "@lloyal-labs/rig";
import { settings } from "@lloyal-labs/rig/node";   // ability config carries paths, checked on disk before anything persists
import { createCorpusAbility } from "@lloyal-labs/corpus-ability";
import { createWebAbility } from "@lloyal-labs/web-ability";
import { createDocumentsAbility } from "@lloyal-labs/documents-ability";
import { briefs } from "./brief/brief.js";
import { openLibrary } from "./brief/library.js";
import type { Command, WorkflowEvent } from "./brief/protocol.js";
import { HarnessExit } from "./brief/protocol.js";
import * as research from "./research/research.js";   // the planner and the writer, handed to the brief below: swap them here

export const abilities = [createCorpusAbility, createWebAbility, createDocumentsAbility];

export const config = defineConfig({
  ...modelSettings,   // the model block with its yml and env names — never restated here; the abilities family is layered for every app
  "sources.outputDir": { yml: "sources.outputDir", cli: "outputDir", path: true, default: "reports" },
  "defaults.effort": { yml: "defaults.effort", oneOf: ["low", "medium", "high", "ultra"], default: "high" },
  "defaults.reasoningMode": { yml: "defaults.reasoningMode", cli: "reasoningMode", oneOf: ["flat", "deep"], default: "flat" },
  "defaults.guards": { yml: "defaults.guards", check: isGuardOverrides },
});
export type Config = ConfigOf<typeof config>;
export type Origin = OriginOf<typeof config>;

export function* harness(ctx: SessionContext, events: EventBus<WorkflowEvent>, commands: Signal<Command, void>): Operation<void> {
  const { session, wire, runner, registry, store, disabled } = yield* initializeHarness(ctx, events, { abilities, config });
  for (const { name, reason } of disabled) yield* wire.send({ type: "ui:error", message: `${name} ability disabled: ${reason}` });

  const run = yield* useExecution();   // one live operation per session; replacing waits for teardown
  const library = yield* openLibrary(() => runner.config().sources.outputDir, { events, registry, wire, run, abilities });
  const brief = briefs({ session, library, run, wire, config: runner.config, research });
  yield* wire.send({ type: "weights:done" });   // ready: the model is resident and the abilities are enabled

  if (runner.mode === "oneshot") {
    if (!runner.initialQuery) throw new HarnessExit("Non-TTY mode requires --query.", 2);
    const accepted = yield* brief.submit(runner.initialQuery, { review: false });
    if (accepted) yield* accepted;   // the run's own future: it settles, or its failure is the exit code
    return;
  }
  if (runner.initialQuery) yield* brief.submit(runner.initialQuery);
  yield* serveCommands<Command>(commands, [brief, library, settings({ runner, registry, store, wire, run, abilities, config })],
    { onError: brief.fail, until: brief.fatal() });   // a poisoned owner ends the session itself; no command carries that
}
