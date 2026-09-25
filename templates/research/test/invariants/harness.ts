/**
 * The behavioural rig for this app: rig's `runHarness` (`@lloyal-labs/rig/testing` — the scripted model, the
 * served runner, the captured wire and trace, the choreography cursor) booted on this app's `harness` and
 * `config`, plus the vocabulary only this app has: what a yes or an answer to the planner must name (the
 * revision the wire announced), a settled brief planted on disk, and the docId an ask minted.
 *
 * Scripting is rig's — utterances (`text` / `report` / `tool`), steps (`send` / `on` / `until`) — see its module
 * doc. A `kind: 'report'` utterance is presented as a call of research's own report tool unless `terminal` says
 * another.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadYml } from "@lloyal-labs/rig/node";
import { runHarness as runRig } from "@lloyal-labs/rig/testing";
import type { HarnessRun as RigRun, HarnessSpec as RigSpec, Sendable as RigSendable, Step as RigStep } from "@lloyal-labs/rig/testing";
import { harness, config } from "../../src/app.js";
import { writeBrief } from "../../src/harness/library.js";
import type { WorkflowEvent, Command } from "../../src/protocol.js";

/** The scaffold itself — where its harness.yml is. */
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export type { Utterance } from "@lloyal-labs/rig/testing";
export { dirs, typesOf, warmDeltas, prunesOf, sessionReleasesOf } from "@lloyal-labs/rig/testing";

export type Sendable = RigSendable<Command>;
export type Step = RigStep<Command, WorkflowEvent>;
export type HarnessRun = RigRun<WorkflowEvent>;

type Spec = RigSpec<typeof config, Command, WorkflowEvent>;

export interface HarnessSpec extends Omit<Spec, "harness" | "config" | "override" | "observe"> {
  /** Merged over the minimal config; `sources.outputDir` is always the rig's fresh temp dir (exposed on the run). */
  config?: Spec["override"];
  /** The composition to run in place of the app's own `harness` — a scenario that swaps a part. */
  harness?: typeof harness;
}

/** The planning round the harness last armed (`ui:plan_review` / `ui:clarify`) in the run in flight — what a yes or an
 *  answer must name. Scenarios run one at a time, so one module-level number is the current run's. */
let latestRevision = 0;
/** A yes to the parked plan, at the revision the wire announced. Send as a thunk: it reads the revision when it fires. */
export const accept: Sendable = () => ({ type: "accept_plan", revision: latestRevision });
/** An answer to the planner's questions, at the round announced. */
export const answer = (text: string): Sendable => () => ({ type: "submit_clarification", revision: latestRevision, answer: text });
/** The round announced last — for a command built by hand at fire time. */
export const revision = (): number => latestRevision;

/** Plant a settled brief the library will list: its record and the markdown beside it, written the way the library writes them. */
export function writeReportFixture(outputDir: string, docId: string, title: string, body: string): void {
  const dir = path.join(outputDir, docId);
  fs.mkdirSync(dir, { recursive: true });
  writeBrief(dir, {
    version: 1, query: title, savedAt: docId, mode: "flat", effort: "low", direct: false,
    attachments: [], answer: body, inquiries: [], elapsedMs: 1000,
  }, { exchange: false, annexuresFrom: 0 });
}

export async function runHarness(spec: HarnessSpec = {}): Promise<HarnessRun> {
  const { config: override, harness: compose, ...rest } = spec;
  latestRevision = 0;
  return runRig<typeof config, Command, WorkflowEvent>({
    ...rest,
    harness: compose ?? harness,
    // The app's own table over the scaffold's own harness.yml — the models it names are the ones the scenarios
    // run against, so a change to the file is a change to the tests — with the rig's temp dir as the library
    // and `low` effort. A scenario without a service clears its block (`model: { vision: "" }`), the way a
    // harness developer would.
    config: {
      table: config,
      yml: (outputDir) => {
        // Everything the file says stands — its guards included — with only the library and the effort replaced.
        const committed = loadYml(config, ROOT);
        return {
          ...committed,
          sources: { ...committed.sources, outputDir },
          defaults: { ...committed.defaults, effort: "low" },
        };
      },
    },
    ...(override ? { override } : {}),
    observe: (ev) => { if (ev.type === "ui:plan_review" || ev.type === "ui:clarify") latestRevision = ev.revision; },
  });
}

/** The docId minted by the nth query event on the wire. */
export const docIdOfQuery = (events: readonly WorkflowEvent[], nth = 0): string => {
  const q = events.filter((e) => e.type === "query")[nth] as
    | { docId: string }
    | undefined;
  if (!q) throw new Error(`no query event #${nth} on the wire`);
  return q.docId;
};
