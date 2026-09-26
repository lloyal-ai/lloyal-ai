/**
 * The behavioural rig for this app: rig's `runHarness` (`@lloyal-labs/rig/testing` — the scripted model, the
 * served runner, the captured wire and trace, the choreography cursor) booted on this app's `harness` and
 * `config`.
 *
 * Everything here is binding, not mechanism. rig owns the scripting — utterances (`text` / `report` / `tool`)
 * and steps (`send` / `on` / `until`), see its module doc — and this file only ties rig's generics to the two
 * types this app declares, `Command` and `WorkflowEvent`. That is the whole of basic's own test vocabulary:
 * it has no library to plant a fixture in, no plan to answer, and no minted id to read back.
 *
 * Why it exists at all: until it did, nothing exercised the program, the prompts or the command loop. basic's
 * other tests are pure view-side folds, so an engine regression had nowhere to show up — a call the pool could
 * not accept sat in `harness.ts` while `npm test` stayed green, reachable only through `typecheck`.
 */
import { runHarness as runRig } from "@lloyal-labs/rig/testing";
import type {
  HarnessRun as RigRun,
  HarnessSpec as RigSpec,
  Sendable as RigSendable,
  Step as RigStep,
} from "@lloyal-labs/rig/testing";
import { harness, config } from "../../src/app.js";
import type { Command, WorkflowEvent } from "../../src/protocol.js";

export type { Utterance } from "@lloyal-labs/rig/testing";
export { dirs, typesOf, warmDeltas, prunesOf, sessionReleasesOf } from "@lloyal-labs/rig/testing";

export type Sendable = RigSendable<Command>;
export type Step = RigStep<Command, WorkflowEvent>;
export type HarnessRun = RigRun<WorkflowEvent>;

type Spec = RigSpec<typeof config, Command, WorkflowEvent>;

export interface HarnessSpec extends Omit<Spec, "harness" | "config" | "override"> {
  /** Merged over the minimal config; `sources.outputDir` is always the rig's fresh temp dir (exposed on the run). */
  config?: Spec["override"];
  /** The composition to run in place of the app's own `harness` — a scenario that swaps a part. */
  harness?: typeof harness;
}

export async function runHarness(spec: HarnessSpec = {}): Promise<HarnessRun> {
  const { config: override, harness: compose, ...rest } = spec;
  return runRig<typeof config, Command, WorkflowEvent>({
    ...rest,
    harness: compose ?? harness,
    // The app's own table, layered over an empty manifest with the rig's temp dir to write into.
    config: { table: config, yml: (outputDir) => ({ sources: { outputDir } }) },
    ...(override ? { override } : {}),
  });
}

/** The text of the nth `answer` event — what the reader is shown, and what the turn committed. */
export const answerOf = (events: readonly WorkflowEvent[], nth = 0): string => {
  const a = events.filter((e) => e.type === "answer")[nth] as { text: string } | undefined;
  if (!a) throw new Error(`no answer event #${nth} on the wire`);
  return a.text;
};
