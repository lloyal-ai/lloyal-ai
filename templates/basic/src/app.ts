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
import { each } from "effection";
import type { Operation, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import type { EventBus } from "@lloyal-labs/binding";
import { defineConfig, modelSettings, initializeHarness } from "@lloyal-labs/rig";
import type { ConfigOf, OriginOf } from "@lloyal-labs/rig";
import { createWikipediaAbility } from "@lloyal-labs/wikipedia-ability";
import { runQuery } from "./harness/harness.js";
import type { Command, WorkflowEvent } from "./harness/protocol.js";

/**
 * The Abilities this harness enables. Before enabling, the boot provisions
 * whatever models each ability declares (wikipedia needs nothing; corpus/web
 * need a reranker) — so add an installed ability's factory here and the model it
 * needs is fetched for you. Install more with `lloyal install <ability>`.
 */
export const abilities = [createWikipediaAbility];

/**
 * This harness's config surface. `modelSettings` is the model block with its yml
 * paths and env names, layered for every app and never restated. `version` and
 * the `abilities` family are rig's and are not declared here.
 *
 * Add a knob by adding a line: the key is the path in the resolved config, and
 * the entry says where each layer reads it from. The MECHANICS — precedence,
 * atomic writes, provenance, `~` expansion — are rig's and are not yours to
 * maintain.
 */
export const config = defineConfig({
  ...modelSettings,
  "sources.outputDir": { yml: "sources.outputDir", cli: "outputDir", path: true, default: "." },
});
export type Config = ConfigOf<typeof config>;
export type Origin = OriginOf<typeof config>;

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
 * The program itself is `runQuery`, in `harness/harness.ts`. That is the file to
 * edit; nothing else in the project needs to know what you wrote there.
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

  // The command loop. Ends on `quit` (or when the Session closes and the scope
  // unwinds). Everything the surface can ask for is a member of `Command`.
  for (const cmd of yield* each(commands)) {
    if (cmd.type === "quit") return;
    if (cmd.type === "submit_query") {
      try {
        // Announce the turn before any work. A warm trunk means this turn
        // deepens the article already on the page rather than starting one.
        yield* wire.send({ type: "query", text: cmd.query, warm: !!session.trunk });
        const answer = yield* runQuery(cmd.query, session, wire);
        yield* wire.send({ type: "answer", text: answer });
      } catch (err) {
        yield* wire.send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    yield* each.next();
  }
}
