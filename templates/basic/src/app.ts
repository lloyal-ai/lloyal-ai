/**
 * What this app is: what is installed, what it reads, and how its parts are put
 * together. Nothing runs at import.
 *
 * The three exports here are the whole contract a target entry needs —
 * `targets/cli/index.ts` and `targets/web/serve.ts` each hand this object to one
 * of rig's boots and add nothing else. Everything those boots do (the layered
 * config, the model resolved and fetched, the resident context, the abilities'
 * services, the trace sink, the Runner, the binding the environment picks) is
 * the platform's; what is yours is `harness` below and the program it calls.
 */
import { statSync } from "node:fs";
import { basename } from "node:path";
import { spawn } from "effection";
import type { Operation, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import type { EventBus } from "@lloyal-labs/binding";
import { initializeHarness, serveCommands, serveDefaults, useExecution } from "@lloyal-labs/rig";
import { config } from "./config.js";
import { createWikipediaAbility } from "@lloyal-labs/wikipedia-ability";
import { articles } from "./harness/article.js";
import type { Articles } from "./harness/article.js";
import type { Command, WorkflowEvent } from "./protocol.js";
import { HarnessExit } from "./protocol.js";

/**
 * The Abilities this harness enables. Before enabling, the boot provisions
 * whatever models each ability declares (wikipedia needs nothing; corpus/web
 * need a reranker) — so add an installed ability's factory here and the model it
 * needs is fetched for you. Install more with `lloyal install <ability>`.
 */
export const abilities = [createWikipediaAbility];

// The config table is its own node-free module, so the view can read it too.
export { config } from "./config.js";
export type { Config, Origin } from "./config.js";

/**
 * What to CALL the model in the header: whichever selection actually won.
 *
 * A configured `model.path` outranks the catalog id, and the boot resolves both
 * into `model.path` — so reading `model.id` alone would name the yml's catalog
 * entry while entirely different weights are resident. Provenance is what tells
 * the two apart: anything but `default` on `model.path` means someone chose it.
 */
function modelLabel(
  model: { id?: string; path?: string },
  origin: Record<string, string>,
): string {
  const chosen = origin["model.path"] !== undefined && origin["model.path"] !== "default";
  if (chosen && model.path) return basename(model.path);
  return model.id ?? (model.path ? basename(model.path) : "model");
}

/** The resolved weight's size on disk, for the boot header. Measured here rather
 *  than carried in config: the boot resolves the path, so the file IS the fact,
 *  and a stat that fails is a header without a size, never a failed boot. */
function weightBytes(path: string | undefined): number {
  if (!path) return 0;
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Your harness — the platform contract, and the thin half of it.
 *
 * `ctx` is the resident model; `events` streams your `WorkflowEvent`s to
 * whatever surface is mounted (terminal / Electron / browser); `commands`
 * delivers that surface's `Command`s back. `initializeHarness` does the boot
 * every harness shares — the agent runtime, the ability registry, the pool's
 * defaults, the wind-down and cancel signals, and the first two events on the
 * wire — and hands back the parts to compose over. What is left here is this
 * app's own: announce readiness, then serve commands.
 *
 * The program itself is `harness/wiki.ts`. That is the file to edit; nothing
 * else in the project needs to know what you wrote there. `harness/article.ts`
 * sits between the two — what a reader can do, and what happens when they do it.
 */
export function* harness(
  ctx: SessionContext,
  events: EventBus<WorkflowEvent>,
  commands: Signal<Command, void>,
): Operation<void> {
  const { session, wire, runner, registry, disabled } = yield* initializeHarness(ctx, events, {
    abilities,
    config,
  });
  for (const { name, reason } of disabled) {
    yield* wire.send({ type: "ui:error", message: `${name} ability disabled: ${reason}` });
  }

  // `run` owns whatever long work is live, ONE operation at a time: a replacement waits for the last one's
  // cleanup before it touches the model, and a Stop can always reach what is running. `article` is what a
  // reader can do; it hands its work to `run` and never waits on the model, which is why the loop below
  // keeps dispatching while an answer is still being written.
  const run = yield* useExecution();
  const article = articles({
    session,
    run,
    wire,
    root: () => (runner.config() as { sources: { outputDir: string } }).sources.outputDir,
  });

  // Boot done — announce it with MEASURED facts, not hardcoded strings: the
  // model's id, the weight's size read off the file the boot actually resolved,
  // and the abilities actually enabled (read from the registry). Every surface
  // folds this one event, so the header is identical everywhere.
  //
  // Which surface is mounted is NOT here. A renderer already knows what it is,
  // so putting it on the wire made the harness carry a fact only the view reads
  // — and made the served boot write `surface: "web"` into config to say it.
  const model = runner.config().model as { id?: string; path?: string };
  yield* wire.send({
    type: "ready",
    facts: {
      model: { id: modelLabel(model, runner.origin()), sizeBytes: weightBytes(model.path) },
      abilities: registry.enabled().map((a) => a.name),
    },
  });

  // What survived earlier sessions, before the first question — the landing shows it. The grouping runs
  // beside the session rather than in front of it: the list paints at once and rearranges when the model
  // answers, because a landing that waited on a model call would make the app feel slower, not cleverer.
  yield* article.shelf();
  yield* spawn(() => article.classify());

  // A terminal with nobody at it: one question, and the run's outcome is the exit code.
  if (runner.mode === "oneshot") return yield* once(article, runner.initialQuery);

  // The loop. One command at a time, each handler under its own boundary, ending on `quit`. What happens when
  // a handler throws, a command has no handler, or the run can no longer be trusted is rig's
  // (`serveDefaults`); what this app gives up on a failed handler is its own — the turn in flight.
  if (runner.initialQuery) yield* article.submit(runner.initialQuery);
  yield* serveCommands<Command>(commands, [article], serveDefaults({ wire, run, abandon: article.abortRun }));
}

/** One question, no reader. `submit` returns once the run is accepted, so wait for the run itself as well:
 *  nobody can stop this one, and its failure is ours to exit with. */
function* once(article: Articles, query: string | undefined): Operation<void> {
  if (!query) throw new HarnessExit("Non-TTY mode requires --query.", 2);
  const accepted = yield* article.submit(query);
  yield* accepted;
}
