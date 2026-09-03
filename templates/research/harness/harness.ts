/**
 * Your harness — the platform contract: a headless generator
 * `harness(ctx, events, commands)`.
 *
 * `ctx` is the resident model; `events` streams your `WorkflowEvent`s to whatever
 * surface is mounted; `commands` delivers that surface's `Command`s back. This
 * harness runs the RACE/DRB-tuned pipeline — pre-flight recon → planner →
 * parallel/chain research pool → synthesis — over the substrate a target's boot
 * established. It reads `RunnerCtx` (bound below, over rig's Runner) for the edge-shell
 * concerns it can't own: the wind-down / cancel signals, the live config, the
 * trace sink. (The reranker is NOT a Runner concern — the boot's
 * `provisionAbilityModels` publishes it on `RerankerCtx`.)
 *
 * The pipeline itself (`runQuery` / `runResearchPlan` / policies / the 7 tuned
 * `.eta` prompts) lives in ./pipeline.ts — this file is the command loop + ability
 * boot that drives it. Edit the pipeline to change what your intelligence does;
 * drop a `prompts/<name>.eta` into the project to override a tuned prompt.
 *
 * LINEAGE: evolved from reasoning.run 0.8.0 — drift is deliberate; the
 * design record is docs/document-identity.md.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, each, call } from "effection";
import type { Operation, Task, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import {
  initAgents,
  WindDown,
  CancelAgent,
  reconstructBranch,
  Pause,
  Ingress,
  Attachments,
  prepareBatch,
  RerankerCtx,
} from "@lloyal-labs/lloyal-agents";
import type {
  Ability,
  AbilityFactory,
  AbilityRegistry,
  AbilityConfigStore,
} from "@lloyal-labs/lloyal-agents";
import { asAttachment, materialize } from "@lloyal-labs/media";
import type { Attachment, Descriptor } from "@lloyal-labs/media";
import type { EventBus } from "@lloyal-labs/binding";
import {
  createInMemoryConfigStore,
  createAbilityRegistry,
} from "@lloyal-labs/rig";
import { buildAbilityDescriptors } from "@lloyal-labs/rig";
import type { PlanResult } from "@lloyal-labs/rig";
import { TASK_ROUTING_KEY } from "@lloyal-labs/rig";
import { createWebAbility } from "@lloyal-labs/web-ability";
import { createCorpusAbility } from "@lloyal-labs/corpus-ability";
import {
  abilityToc,
  runQuery,
  runResearchPlan,
  singleTaskPlan,
  createCoverageCache,
  CoverageCacheCtx,
  PromptsCtx,
  type Effort,
} from "./pipeline.js";
import type { Config } from "./config-types.js";
import type { WorkflowEvent, Command } from "./protocol.js";
import type { AbilityDescriptor, DocId } from "./state.js";
import { RunDirSink } from "./run-dir.js";
import { resolvePath } from "@lloyal-labs/rig/node";
import { RunnerCtx } from "./runner-ctx.js";
import { confinedReport, listReports, readReport, readThread, removeReport } from "./library.js";
import type { ConfigOrigin, SaveResult } from "./config-types.js";

// The two first-party ability factories this harness enables. Before enabling, the
// boot's `provisionAbilityModels` reads whatever Services each ability declares
// (corpus/web both declare `services: ['reranker']`), resolves + loads the
// backing model, and publishes it on `RerankerCtx` — so the harness stays IO-free.
// Install more with `lloyal install <ability>` and add the factory here.
export const abilities: AbilityFactory[] = [createCorpusAbility, createWebAbility];
const abilitiesInstalled: readonly AbilityFactory[] = abilities;

const WEB_ABILITY = "web";
const CORPUS_ABILITY = "corpus";

/** Name → factory for the two first-party abilities this build ships. Drives the
 *  `set_ability_config` re-enable path (NOT config-write routing, which is
 *  name-driven by the command payload). Returns undefined for unknown names. */
const ABILITY_FACTORIES: Record<string, AbilityFactory> = {
  [WEB_ABILITY]: createWebAbility,
  [CORPUS_ABILITY]: createCorpusAbility,
};
function factoryFor(name: string): AbilityFactory | undefined {
  return ABILITY_FACTORIES[name];
}

/** Whether the named ability's factory needs stored config to enable. The web ability
 *  runs config-less (keyless search fallback); the corpus ability needs a path. */
function abilityRequiresConfig(name: string): boolean {
  return name !== WEB_ABILITY;
}

/** The ONE definition of "this config value is a path": the key says so
 *  (`…Path`) or the value starts path-shaped (~ / .). resolveConfigPaths
 *  resolves by it and set_ability_config validates existence by it — one
 *  predicate, so the resolver and the validator can never drift. */
function isPathShaped(key: string, value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    (/path$/i.test(key) || /^[~/.]/.test(value))
  );
}

/** Resolve path-shaped string values in an ability-config object at the
 *  UI→harness boundary — no per-ability name knowledge. */
function resolveConfigPaths(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = isPathShaped(key, value) ? resolvePath(value) : value;
  }
  return out;
}

const MAX_TOOL_TURNS = 10;

/** The corpus:indexed payload for a freshly-(re)enabled ability: file count
 *  from its `toc` advert (one line per file). */
function corpusIndexedEvent(ability: Ability, corpusPath: unknown) {
  const toc = abilityToc(ability);
  return {
    type: "corpus:indexed" as const,
    corpusPath: String(corpusPath ?? ""),
    fileCount: toc ? toc.split("\n").filter(Boolean).length : 0,
    chunkCount: 0,
  };
}

// ── Planner context ──────────────────────────────────────────────

/** Summarize the registered abilities for the planner prompt: the source catalog the
 *  planner routes against. With ≥2 sources the planner assigns each task's routing key
 *  to the source that holds it — grounded by the pre-flight coverage probe that
 *  runQuery folds into the context alongside this catalog. */
function buildPlannerContext(abilities: readonly Ability[]): string {
  if (abilities.length === 0) return "";
  const lines: string[] = [
    `Knowledge sources available for this research. Assign each task's \`${TASK_ROUTING_KEY}\` to the source that holds it, using its EXACT name below; the pre-flight \`Source coverage\` probe (when present) is the primary signal for which source covers what.`,
  ];
  for (const ability of abilities) {
    const protocol = ability.manifest.protocol;
    lines.push("", `### ${protocol.name}`, protocol.useWhen);
    const toc = abilityToc(ability);
    if (toc) {
      lines.push("Files and top-level topics available in this source:", toc);
    }
  }
  return lines.join("\n");
}

// ── Installed-Abilities surfacing (Settings drawer) ──────────────
//
// Manifest-only by design: a scaffold ships no hardcoded catalog URL, and
// the austere views have no Settings drawer, so there is no catalog-metadata
// join (title/iconUrl/entitlements) — one descriptor per registry-ENABLED
// ability, built from the ability's OWN manifest. Display-only; forwarded to
// the renderer via `abilities:state`.

/** Ability config can carry credentials (a `tavilyKey`). VALUES never ride
 *  the event bus — on a served placement the bus terminates in every connected
 *  tenant's renderer. Entries redact to key-presence (`key: true`) so a
 *  surface can show WHAT is configured without seeing secrets; the real values
 *  stay server-side in the config store and the runner. */
function redactAbilities(config: Config): Config {
  return {
    ...config,
    abilities: Object.fromEntries(
      Object.entries(config.abilities).map(([name, cfg]) => [
        name,
        Object.fromEntries(Object.keys(cfg).map((k) => [k, true])),
      ]),
    ),
  };
}

/** The config:updated payload — REDACTION LIVES INSIDE THE BUILDER. On a
 *  served placement the bus ends in every tenant's renderer, and ability
 *  config carries credentials; an emission that had to REMEMBER to redact
 *  would eventually forget. Building the payload here makes forgetting
 *  unrepresentable. */
function configUpdatedEvent(
  saved: SaveResult & { config: Config; origin: ConfigOrigin },
) {
  return {
    type: "config:updated" as const,
    config: redactAbilities(saved.config),
    origin: saved.origin,
    savedTo: saved.path,
    gitignored: saved.gitignored,
    skipped: saved.skipped,
  };
}

// ── Clarify helpers ──────────────────────────────────────────────

/** Render the planner's clarify questions as an assistant-style markdown message,
 *  committed to `session.trunk` paired with the user's input so subsequent planner
 *  forks attend over prior clarify rounds via KV inheritance. */
function formatClarifyAsAssistantMsg(questions: readonly string[]): string {
  return [
    "I need to clarify a few things before researching:",
    "",
    ...questions.map((q, i) => `${i + 1}. ${q}`),
  ].join("\n");
}

// ── Error helpers ────────────────────────────────────────────────

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * A oneShot precondition/abort the harness can't proceed past (missing --query,
 * no source configured, a clarify it can't answer in non-TTY mode). Thrown rather
 * than `process.exit`ed so `harness` stays a pure `Operation<void>` — killing the
 * process is the runner's job. The boot catches it, writes `message`, and exits
 * `exitCode`; the Effection scope unwinds cleanly (teardowns run).
 */
class HarnessExit extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "HarnessExit";
  }
}

/** The one identity mint: ISO-timestamp shaped, sortable, URL-safe. Same
 *  string keys the fold's DocState, /brief/:docId, and outputDir/<docId>/
 *  on disk. */
function mintDocId(): DocId {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

/** A planner result held for review. Carried whole between the plan-review
 *  commands (edit, change-mode, clarify, accept) so a re-plan keeps the
 *  submission's own clock, filter, and clarify history. */
interface PendingPlan {
  plan: PlanResult;
  /** The document this plan belongs to — one identity from echo to run-dir. */
  docId: DocId;
  query: string;
  /** The user side of the next trunk turn is ALREADY prefilled, so the run
   *  must close with `prefillAssistant` rather than `commitTurn` (which would
   *  re-emit it). Two things set it: a clarify round (`prefillUser`), and a
   *  query that arrived with images (`prefillUserMultimodal`). Named for the
   *  state, not for either cause. */
  userSidePending: boolean;
  mode: "flat" | "deep";
  wallStartMs: number;
  abilityFilter: readonly string[];
  /** Roots for images that rode the query — carried through the plan-review
   *  park so `accept_plan`'s `startRunDir` records them; without this the
   *  deep report's meta line loses its `media` entry and a reopened report
   *  shows no figure. */
  attachments?: readonly Descriptor[];
}

// ── harness — the Layer-3 entrypoint (platform contract) ─────────
//
// Runs INSIDE a runtime substrate the boot established (RerankerCtx via the
// boot's `provisionAbilityModels`, the agent contexts `initAgents` sets). It reads `RunnerCtx`
// for the edge-shell concerns it can't own. `events` is the UI `WorkflowEvent`
// bus; `agentEvents` (from `initAgents`) is the internal agent channel the
// forwarder relays into `events` + `RunDirSink`. Ends on Session close.

export function* harness(
  ctx: SessionContext,
  events: EventBus<WorkflowEvent>,
  commands: Signal<Command, void>,
): Operation<void> {
  const runner = yield* RunnerCtx.expect();
  const oneShot = runner.mode === "oneshot";

  // Seed the renderer's config view — the first event every surface folds.
  // The runner is in-memory today, so there is no file `path`; a disk-backed
  // runner adds it.
  events.send({
    type: "config:loaded",
    config: redactAbilities(runner.config()),
    origin: runner.origin(),
    dev: runner.dev,
  });

  // ── Session + event forwarding ─────────────────────────────
  const runDirSink = new RunDirSink();

  const { session, events: agentEvents } = yield* initAgents<WorkflowEvent>(ctx, {
    traceWriter: runner.traceWriter,
    attachmentStore: runner.attachmentStore,
  });

  // Replay mode: rebuild the spine from the captured checkpoint and install it as
  // the session trunk BEFORE the abilities register their listeners.
  if (runner.replayCheckpoint) {
    const replaySpine = yield* reconstructBranch(runner.replayCheckpoint);
    session.trunk = replaySpine;
  }

  // THE BUS RULE — two sends, one decision, stated once: anything that is
  // part of the RUN RECORD (run events, doc lifecycle, config echoes, error
  // announcements) rides `agentEvents` — this forwarder gives it to the
  // run-dir sink AND the UI. Pure UI chrome the record never needs
  // (config:loaded at boot, weights:*, corpus:indexed) rides `events`
  // directly. When adding an emission, pick by asking: does a replay of the
  // run dir need it?
  //
  // Spawned children of this iteration's scope auto-halt on return.
  yield* spawn(function* () {
    for (const ev of yield* each(agentEvents)) {
      runDirSink.handle(ev as WorkflowEvent);
      events.send(ev as WorkflowEvent);
      yield* each.next();
    }
  });

  // ── Ability registry ───────────────────────────────────────────
  // The reranker is already published on RerankerCtx by the boot's
  // `provisionAbilityModels` (before this harness runs), so the corpus/web factories
  // read it on enable. The registry owns each ability's detached scope and tears them
  // down on scope exit. It also sets AbilityRegistryCtx, which the research pool reads
  // to render the spine and resolve per-spawn tool scope.
  yield* WindDown.set(runner.windDown);
  yield* CancelAgent.set(runner.cancelAgent);
  yield* Pause.set(runner.pauseRun);
  const configStore = createInMemoryConfigStore();
  // Seed the config store generically from the per-ability config map — no ability-name
  // knowledge. Each ability's factory reads its own entry on enable.
  for (const [name, cfg] of Object.entries(runner.config().abilities)) {
    yield* configStore.set(name, cfg);
  }
  const registry = yield* createAbilityRegistry({ configStore });

  // Per-boot preflight-coverage memo, spanning every command-loop iteration.
  yield* CoverageCacheCtx.set(yield* createCoverageCache());

  // The project's prompt-override dir, cwd-relative. Set ONLY when it exists — an
  // absent `prompts/` keeps the RACE/DRB-tuned baked defaults with no prompt-file
  // I/O (see resolvePrompt). Override a prompt by dropping `prompts/<name>.eta`.
  const promptsDir = path.join(process.cwd(), "prompts");
  if (fs.existsSync(promptsDir)) yield* PromptsCtx.set(promptsDir);

  // Enable the corpus ability first so installed()[0] is corpus when present. It only
  // enables when the user has stored config for it (the factory needs a
  // corpusPath). A bad path surfaces a toast and leaves the ability disabled.
  const corpusBootCfg = runner.config().abilities[CORPUS_ABILITY];
  if (corpusBootCfg && Object.keys(corpusBootCfg).length > 0) {
    events.send({ type: "weights:label", label: "Indexing corpus…" });
    try {
      const corpusAbility = yield* registry.enable(createCorpusAbility);
      events.send(corpusIndexedEvent(corpusAbility, corpusBootCfg.corpusPath));
    } catch (err) {
      events.send({
        type: "ui:error",
        message: `Corpus disabled: ${errorMessage(err)}. Use /scan to fix.`,
      });
    }
  }
  // Web is always available: createWebAbility falls back to a keyless provider when no
  // tavilyKey is configured. Enable it unconditionally.
  try {
    yield* registry.enable(createWebAbility);
  } catch (err) {
    events.send({
      type: "ui:error",
      message: `Web search disabled: ${errorMessage(err)}.`,
    });
  }

  // Surface the installed Abilities into the renderer. Re-call after every
  // registry enable/disable/config change so the drawer stays in sync.
  function* emitAbilities(): Operation<void> {
    const abilities = yield* buildAbilityDescriptors(registry, configStore, abilitiesInstalled);
    yield* agentEvents.send({ type: "abilities:state", abilities });
  }

  // Emit once boot completes (web/corpus enabled).
  yield* emitAbilities();

  events.send({ type: "weights:done" });

  // Boot-immutable facts ONLY. Live values (reasoningMode, effort) are
  // passed explicitly per call — a default snapshotted here would go stale
  // the moment the user changed it, and a spread that forgot to override
  // would silently run at boot values.
  const harnessOpts = {
    maxTurns: MAX_TOOL_TURNS,
    findingsMaxChars: runner.findingsMaxChars,
  };

  /** The folder IS the docId. An ask over a settled document threads
   *  beside its report; anything else writes the document's own dir.
   *  Same-id reuse is unreachable by construction: every planner submit
   *  mints a fresh id and every ask threads. */
  function startRunDir(
    docId: DocId,
    query: string,
    mode: "flat" | "deep",
    attached: readonly Descriptor[] = [],
  ): void {
    const attachments = attached.map((a) => a.digest);
    run.docId = docId;
    const dir = path.join(libraryDir(), docId);
    if (fs.existsSync(path.join(dir, "report.md"))) {
      runDirSink.startThread({ dir, query, mode, attachments });
      return;
    }
    runDirSink.start({ dir, query, mode, attachments });
  }

  const libraryDir = (): string =>
    runner.config().sources.outputDir ?? process.cwd();

  // Every settled brief becomes retrievable ground for the next one: when
  // the corpus ability is enabled, re-enable it after a run completes so the
  // fresh report and annexures join the index — riding the reconfigure
  // lifecycle (the factory re-reads its config on enable), no config write.
  // The sink writes report.md on the same `complete` the pipeline just sent;
  // a lost race merely defers that report to the next settle's re-index.
  function* reindexCorpus(): Operation<void> {
    if (!registry.byName(CORPUS_ABILITY)) return;
    const cfg = (yield* configStore.get(CORPUS_ABILITY)) ?? {};
    try {
      yield* registry.disable(CORPUS_ABILITY);
      const ability = yield* registry.enable(createCorpusAbility);
      events.send(corpusIndexedEvent(ability, cfg.corpusPath));
      yield* emitAbilities();
    } catch (err) {
      yield* agentEvents.send({
        type: "ui:error",
        message: `Corpus re-index failed: ${errorMessage(err)}`,
      });
    }
  }

  // ── JSONL / --query scripted path ──────────────────────────
  if (oneShot) {
    if (!runner.initialQuery) {
      throw new HarnessExit("Non-TTY mode requires --query.", 2);
    }
    const wallStartMs = performance.now();
    const oneShotDocId = mintDocId();
    events.send({
      type: "query",
      docId: oneShotDocId,
      query: runner.initialQuery,
      warm: false,
      effort: runner.config().defaults.effort,
    });
    const result = yield* runQuery(runner.initialQuery, session, {
      ...harnessOpts,
      reasoningMode: runner.config().defaults.reasoningMode,
      effort: runner.config().defaults.effort,
      wallStartMs,
      onStart: () =>
        startRunDir(oneShotDocId, runner.initialQuery!, runner.config().defaults.reasoningMode),
    });
    if (result.type === "clarify") {
      throw new HarnessExit(
        "Planner asked clarifying questions; non-TTY mode can't answer. Aborting.",
        2,
      );
    }
    if (result.type === "research_plan") {
      startRunDir(oneShotDocId, runner.initialQuery, runner.config().defaults.reasoningMode);
      yield* runResearchPlan(runner.initialQuery, result.plan, session, {
        ...harnessOpts,
        reasoningMode: runner.config().defaults.reasoningMode,
        effort: runner.config().defaults.effort,
        wallStartMs,
      });
    }
    return;
  }

  // ── The command loop — every interactive surface ───────────

  // Per-query run effort, set at submit_query and read by every research path.
  let currentEffort: Effort = runner.config().defaults.effort;

  // ── Document identity — the harness's three pointers ─────────
  // activeDocId: what the canvas shows (mirrors the fold's activeDocId).
  // trunkDocId: which document owns session.trunk right now.
  // knownDocs: every docId this connection has touched — lets open_doc
  // activate the RUNNING doc (no report.md yet) without a disk read.
  let activeDocId: DocId | null = null;
  let trunkDocId: DocId | null = null;
  const knownDocs = new Set<DocId>();
  /** The opened report awaiting its lazy KV commit — set by open_doc when
   *  the trunk belongs to another doc, consumed by the first submit over
   *  it. Dedup is structural: while the trunk IS this doc's, open_doc
   *  leaves this null. */
  let openedReport: ReturnType<typeof readThread> | null = null;
  let pendingPlan: PendingPlan | null = null;

  // ── The run lifecycle — ONE place ──────────────────────────
  // The heavy operations run in a CHILD fiber so the command loop keeps
  // polling `each(commands)` while a run is in flight. startRun/haltRun own
  // every transition of these three fields; nothing else writes them. A NEW
  // run never inherits the old run's flags — startRun resets them, and the
  // fiber's own finally clears them only while it is still the current run.
  const run: {
    task: Task<void> | null;
    paused: boolean;
    woundDown: boolean;
    /** The doc the live run writes for — set by startRunDir, cleared with
     *  the run. Lets abortRun remove a stillborn's orphan dir. */
    docId: DocId | null;
  } = {
    task: null,
    paused: false,
    woundDown: false,
    docId: null,
  };

  function* startRun(body: () => Operation<void>): Operation<void> {
    if (run.task) yield* haltRun();
    run.paused = false;
    run.woundDown = false;
    const task = yield* spawn(function* () {
      try {
        yield* body();
      } finally {
        if (run.task === task) {
          run.task = null;
          run.paused = false;
          run.woundDown = false;
          run.docId = null;
        }
      }
    });
    run.task = task;
  }

  function* haltRun(): Operation<void> {
    const task = run.task;
    run.task = null;
    if (!task) return;
    try {
      yield* task.halt();
    } catch {
      /* teardown-only error — the run is gone regardless */
    }
  }

  /** Abandon whatever run-shaped thing is in flight — the ONE composition
   *  of the halt (mechanism) with the announcement (lifecycle): halt a live
   *  run, reset its flags, clear a parked plan, and — iff anything was
   *  actually abandoned — announce `run:aborted`, which is what lets the
   *  fold apply its stillborn/standing rule. A stillborn's orphan run dir
   *  (no report.md ever settled) is removed with it: the fold forgets the
   *  document, so the disk must not remember it. `haltRun` stays separate
   *  and SILENT — startRun's defensive re-entry is a handoff, not an
   *  abandonment. */
  function* abortRun(): Operation<void> {
    const hadRun = run.task !== null;
    const dyingDocId = run.docId;
    if (hadRun) yield* haltRun();
    run.paused = false;
    run.woundDown = false;
    run.docId = null;
    if (hadRun && dyingDocId !== null) {
      const dir = path.join(libraryDir(), dyingDocId);
      if (!fs.existsSync(path.join(dir, "report.md"))) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      // And the harness's own memory of the id: knownDocs exists so open_doc
      // can activate the RUNNING doc; after an abort the doc is neither
      // running nor (if stillborn) on disk — a stale entry rendered an empty
      // ghost shell where the honest "no longer there" toast belongs. A
      // standing doc reopens via its report.md regardless.
      knownDocs.delete(dyingDocId);
    }
    if (hadRun || pendingPlan) {
      pendingPlan = null;
      yield* agentEvents.send({ type: "run:aborted" });
    }
  }

  // Per-query Ability participation. Default: every enabled ability is included.
  const participation: Record<string, boolean> = {};
  const seedParticipation = (): void => {
    for (const ability of registry.enabled()) {
      if (participation[ability.manifest.name] === undefined) {
        participation[ability.manifest.name] = true;
      }
    }
  };
  const currentAbilityFilter = (): readonly string[] =>
    registry
      .enabled()
      .filter((a) => participation[a.manifest.name] !== false)
      .map((a) => a.manifest.name);
  seedParticipation();

  /** The ONE way the canvas moves: set the harness's mirror pointer and
   *  announce it — the pair (harness activeDocId ↔ fold activeDocId) can
   *  never drift when every activation goes through here. View-only: no KV.
   *  (The submit boundary is the deliberate exception — its `query` echo
   *  carries activation in the fold, and it sets the pointer beside it.) */
  function* activateDoc(docId: DocId | null): Operation<void> {
    activeDocId = docId;
    yield* agentEvents.send({ type: "doc:active", docId });
  }

  // First submit over a restored report: commit it to the trunk — its
  // prefill is the ask's warmup. The WHOLE thread goes to KV: the fold got
  // it structurally, the model needs it as one conversation. Cold path of
  // commitTurn IS the doc-branch factory.
  function* commitOpenedReport(): Operation<void> {
    if (openedReport === null) return;
    const { title, thread } = openedReport;
    openedReport = null;
    yield* call(() => session.commitTurn(title, thread));
  }

  /** Run the planner and route its outcome — the ONE shape submit_query,
   *  submit_clarification, and change_mode share. What differs per caller:
   *  how a clarify message reaches the trunk, and what a returned plan
   *  becomes as the pending plan. A finished run reindexes the corpus and
   *  returns to the composer; an error clears the pending plan and toasts. */
  function* runPlannedQuery(spec: {
    docId: DocId;
    query: string;
    mode: "flat" | "deep";
    wallStartMs: number;
    abilityFilter: readonly string[];
    onStart: () => void;
    clarify: "commit" | "prefill" | "none";
    /** Roots for images already on the trunk — carried so the planner's
     *  `query` event (which resets the fold) can seed them. */
    attachments?: readonly Descriptor[];
    pending: (plan: PlanResult) => PendingPlan;
  }): Operation<void> {
    try {
      const result = yield* runQuery(spec.query, session, {
        ...harnessOpts,
        reasoningMode: spec.mode,
        effort: currentEffort,
        context: buildPlannerContext(registry.enabled()),
        wallStartMs: spec.wallStartMs,
        abilityFilter: spec.abilityFilter,
        onStart: spec.onStart,
      });
      if (result.type === "research_plan") {
        pendingPlan = spec.pending(result.plan);
        yield* agentEvents.send({ type: "ui:plan_review" });
      } else if (result.type === "clarify") {
        // Arm the park FIRST: pendingPlan is what submit_clarification
        // checks, and the KV commit below is slow — arming after it would
        // leave a window where a prompt answer finds nothing armed and is
        // silently dropped. The error path (catch below) still disarms.
        pendingPlan = spec.pending(result.plan);
        const msg = formatClarifyAsAssistantMsg(result.plan.clarifyQuestions);
        if (spec.clarify === "commit") {
          yield* call(() => session.commitTurn(spec.query, msg));
        } else if (spec.clarify === "prefill") {
          yield* call(() => session.prefillAssistant(msg));
        }
      } else {
        pendingPlan = null;
        yield* reindexCorpus();
      }
    } catch (err) {
      // The run DIED — announce it (the fold applies stillborn/standing),
      // then say why.
      pendingPlan = null;
      yield* agentEvents.send({ type: "run:aborted" });
      yield* agentEvents.send({ type: "ui:error", message: errorMessage(err) });
    }
  }

  /** Run an already-vetted plan to a settled brief — shared by accept_plan
   *  and the Ask path's synthetic single-task plan. */
  function* runAcceptedPlan(args: {
    query: string;
    plan: PlanResult;
    mode: "flat" | "deep";
    wallStartMs: number;
    abilityFilter: readonly string[];
    isAsk?: boolean;
    userSidePending?: boolean;
  }): Operation<void> {
    try {
      yield* runResearchPlan(args.query, args.plan, session, {
        ...harnessOpts,
        reasoningMode: args.mode,
        effort: currentEffort,
        wallStartMs: args.wallStartMs,
        abilityFilter: args.abilityFilter,
        isAsk: args.isAsk,
        userSidePending: args.userSidePending,
      });
      yield* reindexCorpus();
    } catch (err) {
      // Same announce-then-toast as runPlannedQuery: the run died.
      yield* agentEvents.send({ type: "run:aborted" });
      yield* agentEvents.send({ type: "ui:error", message: errorMessage(err) });
    }
  }

  // ── The command table ──────────────────────────────────────
  // One handler per Command variant, exhaustively: adding a Command without
  // deciding what the harness does with it is a type error, never a silent
  // no-op. "continue" keeps the loop; "exit" ends the harness (the boot
  // decides what a return means — quit, or a runtime reload).
  type Flow = "continue" | "exit";
  const handle: {
    [K in Command["type"]]: (cmd: Extract<Command, { type: K }>) => Operation<Flow>;
  } = {
    *quit() {
      return "exit";
    },

    *stop() {
      // Covers mid-run AND parked-at-review (`run.task` null, pendingPlan
      // set) — abortRun announces in both.
      yield* abortRun();
      return "continue";
    },

    *wrap_up() {
      // Refused while paused — press play first (the pane disables the
      // button; this guard covers raw wire clients).
      if (run.task && !run.paused) {
        run.woundDown = true;
        runner.windDown.send();
      }
      return "continue";
    },

    *pause() {
      if (run.task && !run.paused && !run.woundDown) {
        run.paused = true;
        runner.pauseRun.send(true);
      }
      return "continue";
    },

    *resume() {
      if (run.paused) {
        run.paused = false;
        runner.pauseRun.send(false);
      }
      return "continue";
    },

    *cancel_agent(cmd) {
      if (run.task) runner.cancelAgent.send({ agentId: cmd.agentId });
      return "continue";
    },

    *set_model_path(cmd) {
      runner.reloadRuntime({ model: { path: cmd.path } });
      return "exit";
    },

    *set_reranker_path(cmd) {
      runner.reloadRuntime({ model: { reranker: cmd.path } });
      return "exit";
    },

    *set_gpu(cmd) {
      runner.reloadRuntime({ model: { gpu: cmd.gpu } });
      return "exit";
    },

    // Both reload the runtime, like set_gpu: the projector reads these at
    // createContext, so a live context cannot adopt a new value. 'auto' ⇒ 0,
    // the binding's unset sentinel.
    *set_image_min_tokens(cmd) {
      runner.reloadRuntime({ model: { imageMinTokens: Number(cmd.value) || 0 } });
      return "exit";
    },
    *set_image_max_tokens(cmd) {
      runner.reloadRuntime({ model: { imageMaxTokens: Number(cmd.value) || 0 } });
      return "exit";
    },

    *toggle_participation(cmd) {
      const current = participation[cmd.name] ?? true;
      participation[cmd.name] = !current;
      yield* agentEvents.send({ type: "participation:toggled", name: cmd.name });
      return "continue";
    },

    *set_ability_config(cmd) {
      const resolvedValues = resolveConfigPaths(cmd.values);
      const isClear = Object.keys(resolvedValues).length === 0;

      // Path-shaped values must EXIST before anything persists or enables:
      // a factory handed a bad path can take the whole process down (rig's
      // loadResources exits on a missing corpus), and a persisted bad path
      // would re-kill every subsequent boot. Generic — same path-shape rule
      // as resolveConfigPaths, no ability-name knowledge.
      const missingPath = Object.entries(resolvedValues).find(
        ([k, v]) => isPathShaped(k, v) && !fs.existsSync(v),
      );
      if (missingPath) {
        yield* agentEvents.send({
          type: "ui:error",
          message: `${missingPath[0]}: path does not exist — ${String(missingPath[1])}`,
        });
        return "continue";
      }

      // Persist FIRST: if the disk save refuses (unreadable/newer
      // harness.json, fs error), the outer catch surfaces it and the live
      // session is untouched — no half-applied ability state. `prior` is
      // kept so an enable failure below can restore the disk too.
      const prior = (yield* configStore.get(cmd.name)) ?? null;
      const saved = runner.saveConfig({
        abilities: { [cmd.name]: resolvedValues },
      });

      yield* configStore.set(cmd.name, resolvedValues);

      const factory = factoryFor(cmd.name);
      if (factory) {
        if (registry.byName(cmd.name)) yield* registry.disable(cmd.name);
        const needsConfig = abilityRequiresConfig(cmd.name);
        if (!isClear || !needsConfig) {
          try {
            const ability = yield* registry.enable(factory);
            if (abilityToc(ability) !== null) {
              events.send(corpusIndexedEvent(ability, resolvedValues.corpusPath));
            }
          } catch (err) {
            // The new config failed to ENABLE — restore ALL the surfaces
            // this command touched: the store, the LIVE registry (a
            // previously working instance was disabled above — bring it
            // back), and the disk. Best-effort throughout: the error toast
            // below reports the original failure regardless.
            if (prior && Object.keys(prior).length > 0) {
              yield* configStore.set(cmd.name, prior);
              try {
                yield* registry.enable(factory);
              } catch {
                // The prior config no longer enables either — leave the
                // ability disabled rather than looping.
                yield* configStore.clear(cmd.name);
              }
            } else {
              yield* configStore.clear(cmd.name);
            }
            try {
              runner.saveConfig({ abilities: { [cmd.name]: prior ?? {} } });
            } catch {
              /* disk restore failed — the toast still reports the enable error */
            }
            yield* agentEvents.send({
              type: "ui:error",
              message: `Cannot configure ${cmd.name}: ${errorMessage(err)}`,
            });
            return "continue";
          }
        } else {
          yield* configStore.clear(cmd.name);
        }
      }

      participation[cmd.name] = true;

      yield* agentEvents.send(configUpdatedEvent(saved));
      yield* emitAbilities();
      return "continue";
    },

    *set_output_dir(cmd) {
      const resolved = cmd.path ? resolvePath(cmd.path) : "";
      const saved = runner.saveConfig({
        sources: { outputDir: resolved },
      });
      yield* agentEvents.send(configUpdatedEvent(saved));
      return "continue";
    },

    *set_effort(cmd) {
      // Save ONLY the changed key — spreading the whole defaults object
      // would pin the untouched ones into harness.json, shadowing later
      // harness.yml edits.
      const saved = runner.saveConfig({ defaults: { effort: cmd.effort } });
      yield* agentEvents.send(configUpdatedEvent(saved));
      return "continue";
    },

    *new_run() {
      // A run in flight is abandoned the same way a fresh submit abandons it.
      yield* abortRun();
      // Drop the restored-report binding: the next submit must not commit a
      // document the user has just cleared. KV stays lazy — the next submit's
      // boundary prunes. The picker is where new documents are born.
      openedReport = null;
      yield* activateDoc(null);
      return "continue";
    },

    *library_search(cmd) {
      // The reranker is the run's scoring instrument; a live run owns it. The
      // sidebar disables its input while a brief writes — this is the same
      // fact host-side, so a stale keystroke cannot queue behind ability
      // scoring.
      if (run.task) return "continue";
      const query = cmd.query.trim();
      if (!query) {
        yield* agentEvents.send({ type: "library:search", query: "", ranked: [] });
        return "continue";
      }
      const entries = listReports(libraryDir());
      if (entries.length === 0) {
        yield* agentEvents.send({ type: "library:search", query, ranked: [] });
        return "continue";
      }
      // Title plus the answer's lead: enough for the cross-encoder to be
      // query-aware, small enough that a library stays a couple of waves of
      // scoring leaves. No index anywhere — at library scale the reranker
      // reads everything fresh, so there is nothing to build or invalidate.
      const texts = entries.map((e) => {
        try {
          const r = readReport(e.path);
          return `${r.title}\n\n${r.body.slice(0, 400)}`;
        } catch {
          return e.title;
        }
      });
      const reranker = yield* RerankerCtx.expect();
      let scores: number[];
      try {
        scores = yield* call(() => reranker.scoreBatch(query, texts));
      } catch (err) {
        yield* agentEvents.send({
          type: "ui:error",
          message: `Search failed: ${errorMessage(err)}`,
        });
        return "continue";
      }
      const ranked = entries
        .map((e, i) => ({ path: e.path, score: scores[i] ?? -Infinity }))
        .sort((a, b) => b.score - a.score)
        .map((r) => r.path);
      yield* agentEvents.send({ type: "library:search", query, ranked });
      return "continue";
    },

    *library_list() {
      yield* agentEvents.send({
        type: "library:list",
        entries: listReports(libraryDir()),
      });
      return "continue";
    },

    *open_doc(cmd) {
      // View-only navigation — allowed DURING runs (it is fold work, zero
      // KV; the lazy commit waits for a submit). The run keeps writing into
      // its own document's state.
      if (cmd.docId === null) {
        openedReport = null;
        yield* activateDoc(null);
        return "continue";
      }
      const reportPath = confinedReport(
        libraryDir(),
        path.join(libraryDir(), cmd.docId, "report.md"),
      );
      if (reportPath !== null) {
        const thread = readThread(reportPath);
        // Lazy KV: only bind for commit when the trunk belongs elsewhere.
        openedReport = trunkDocId === cmd.docId && session.trunk ? null : thread;
        knownDocs.add(cmd.docId);
        // The report kept the ADDRESSES; the store kept the content. Rebuild
        // each descriptor from what is actually on disk — a digest whose
        // manifest is gone is dropped, and the brief reopens without a
        // figure instead of a broken one.
        const contentStore = yield* Attachments.expect();
        const restored: Descriptor[] = [];
        for (const digest of thread.attachments) {
          const bytes = contentStore.get(digest);
          if (bytes) {
            restored.push({
              mediaType: "application/vnd.oci.image.manifest.v1+json",
              digest,
              size: bytes.length,
            });
          }
        }
        yield* agentEvents.send({
          type: "doc",
          docId: cmd.docId,
          title: thread.title,
          mode: null,
          ...(restored.length > 0 ? { attachments: restored } : {}),
          answer: thread.body,
          exchanges: thread.exchanges.map((x) => ({
            question: x.question,
            body: x.body,
            attachments: x.attachments.filter((d) => contentStore.get(d) !== undefined),
          })),
        });
        yield* activateDoc(cmd.docId);
      } else if (knownDocs.has(cmd.docId)) {
        // The RUNNING doc (no report.md yet) — the fold already holds it.
        yield* activateDoc(cmd.docId);
      } else {
        yield* agentEvents.send({ type: "ui:error", message: "That brief is no longer there." });
      }
      return "continue";
    },

    *library_delete(cmd) {
      // Same confinement as the read; deleting a brief removes its WHOLE
      // run dir (report + annexures) and re-indexes the corpus — the
      // system unlearns it. A run in flight can't be targeted: its dir
      // has no report.md until it settles, so the list never offers it.
      const resolved = confinedReport(libraryDir(), cmd.path);
      if (resolved !== null) {
        removeReport(resolved);
        yield* reindexCorpus();
      }
      yield* agentEvents.send({
        type: "library:list",
        entries: listReports(libraryDir()),
      });
      return "continue";
    },

    *submit_query(cmd) {
      // No sources is a legitimate ask — nothing configured, or everything
      // excluded. The run answers from the model and whatever is already in
      // context, with no research; the pool registers whichever abilities ARE
      // included, and none is simply the empty union. Refusing to start
      // would be the harness deciding a question wasn't worth asking.
      const abilityFilter = currentAbilityFilter();
      const wallStartMs = performance.now();
      currentEffort = runner.config().defaults.effort;
      // Abandon the outgoing run OR parked plan — announced, so the fold
      // settles the old document's fate BEFORE the new echo births the next.
      yield* abortRun();
      const { query, mode } = cmd;
      // With Extend gone, "warm" means exactly one thing: an ask under the
      // active document. Anything else births a new identity.
      const warm = !!cmd.skipPlanner && activeDocId !== null;
      const docId = warm ? activeDocId! : mintDocId();
      knownDocs.add(docId);

      // Attached images land on the TRUNK before either path below runs. That
      // ordering is the point: agents fork from the trunk, so one encode is
      // shared by every one of them instead of copied per agent. It also means
      // the user side of this turn is already committed — hence
      // `userSidePending`, which makes the run close with `prefillAssistant`
      // instead of re-emitting the query via `commitTurn`.
      let userSidePending = false;
      // Hoisted out of the block below: the `query` event is what seeds the
      // fold (and RESETS it), and it is emitted on two different paths from
      // here, so the roots have to outlive the barrier's scope.
      let attachments: readonly Descriptor[] = [];
      let prepared: ReturnType<typeof materialize> | null = null;
      if (cmd.attachments && cmd.attachments.length > 0) {
        if (!ctx.supportsVision()) {
          // Say it plainly rather than dropping them: the user is looking at
          // an attachment they believe was sent.
          yield* agentEvents.send({
            type: "ui:error",
            message: "This model can't see images — it has no vision projector. "
              + "Pick a vision-capable model, or ask without the attachment.",
          });
          return "continue";
        }
        // The bytes were admitted on the way IN, over the content plane, so
        // there is nothing to ingest here — only to resolve. That is the whole
        // shape of the descriptor-only wire: normalization and commit happen
        // once, at the HTTP boundary, and the command carries references to
        // what already exists.
        //
        // Two checks, and they are different questions. `asAttachment` asks
        // whether a descriptor is even the KIND of thing that can be a root —
        // cheap, and it refuses a client that sends a representation digest
        // hoping it gets expanded as one. `materialize` asks the STORE whether
        // the content is really there, which is the question no client can
        // answer for itself and the one a forged descriptor fails.
        const contentStore = yield* Attachments.expect();
        const roots = cmd.attachments.map(asAttachment);
        if (roots.some((r) => r === null)) {
          yield* agentEvents.send({
            type: "ui:error",
            message: "That attachment reference isn't an image the host admitted.",
          });
          return "continue";
        }
        try {
          prepared = materialize(contentStore, roots as Attachment[]);
        } catch (err) {
          yield* agentEvents.send({
            type: "ui:error",
            message: `Couldn't read that image back: ${errorMessage(err)}`,
          });
          return "continue";
        }
        attachments = prepared.attachments;
      }

      // ── The doc boundary — Session verbs only. Release the outgoing
      // document's branch before anything touches KV. RESTRICT prune makes
      // the one-branch invariant self-enforcing: switching is only legal
      // between runs (haltRun above tore the run subtree down), and the SDK
      // throws rather than corrupt if a child were somehow alive.
      if (trunkDocId !== docId) {
        yield* call(() => session.dispose());
        trunkDocId = docId;
        // A new document never commits another document's thread.
        if (!warm) openedReport = null;
      }
      activeDocId = docId;

      // The echo: the FIRST event of every accepted submit, sent the moment
      // validation clears. Acknowledgment is wire truth, not a client guess —
      // the slow KV work (trunk commit, image encode) happens behind it.
      yield* agentEvents.send({
        type: "query",
        docId,
        query,
        warm,
        ...(cmd.skipPlanner ? { direct: true } : {}),
        effort: currentEffort,
        ...(attachments.length ? { attachments: [...attachments] } : {}),
      });

      if (warm) yield* commitOpenedReport();

      if (prepared) {
        const p = prepared;
        // Prefilled ONTO THE TRUNK exactly once; every agent forked from it
        // attends the same cells. N agents cost one projection, not N.
        yield* call(() => session.prefillUserMultimodal(
          query,
          p.bitmaps as Uint8Array[],
          { attachments: p.attachments },
        ));
        userSidePending = true;
      }

      // Ask (skipPlanner): the user's question IS the plan — one warm task,
      // no planner. The echo above already carried `query` (direct) — the
      // fold's warm-ask branch saw the ask before this synthetic plan:start,
      // so the plan:start can't retitle the settled document.
      if (cmd.skipPlanner) {
        const plan = singleTaskPlan(query);
        yield* agentEvents.send({ type: "plan:start", query, mode });
        yield* agentEvents.send({
          type: "plan",
          intent: plan.intent,
          tasks: plan.tasks,
          clarifyQuestions: plan.clarifyQuestions,
          tokenCount: plan.tokenCount,
          timeMs: plan.timeMs,
        });
        startRunDir(docId, query, mode, attachments);
        yield* startRun(() =>
          runAcceptedPlan({ query, plan, mode, wallStartMs, abilityFilter, isAsk: true, userSidePending }),
        );
        return "continue";
      }

      yield* startRun(() =>
        runPlannedQuery({
          docId,
          query,
          mode,
          wallStartMs,
          abilityFilter,
          onStart: () => startRunDir(docId, query, mode, attachments),
          clarify: "commit",
          attachments,
          pending: (plan) => ({
            plan,
            docId,
            query,
            userSidePending,
            mode,
            wallStartMs,
            abilityFilter,
            ...(attachments.length ? { attachments } : {}),
          }),
        }),
      );
      return "continue";
    },

    *submit_clarification(cmd) {
      // The park arms inside the planner run's clarify arm, a scheduler hop
      // after the plan event a client keys on — one macrotask covers that
      // gap. And the round-1 commit may still be in flight after arming:
      // await the run so prefillUser never interleaves a cold commitTurn.
      if (!pendingPlan) {
        yield* call(() => new Promise<void>((resolve) => setImmediate(resolve)));
      }
      if (!pendingPlan) return "continue";
      const running = run.task;
      if (running) {
        try {
          yield* running;
        } catch {
          /* the run body catches its own errors; a halt means the park died */
        }
        if (!pendingPlan) return "continue";
      }
      const prior = pendingPlan;
      // The round's echo — same identity, warm:false (planner-path doc);
      // re-seeds the fold and re-opens the pane's run.
      yield* agentEvents.send({
        type: "query",
        docId: prior.docId,
        query: prior.query,
        warm: false,
        effort: currentEffort,
        ...(prior.attachments?.length ? { attachments: [...prior.attachments] } : {}),
      });
      yield* call(() => session.prefillUser(cmd.answer));
      yield* startRun(() =>
        runPlannedQuery({
          docId: prior.docId,
          query: prior.query,
          mode: prior.mode,
          wallStartMs: prior.wallStartMs,
          abilityFilter: prior.abilityFilter,
          onStart: () => startRunDir(prior.docId, prior.query, prior.mode, prior.attachments),
          clarify: "prefill",
          pending: (plan) => ({ ...prior, plan, userSidePending: true }),
        }),
      );
      return "continue";
    },

    *change_mode(cmd) {
      if (!pendingPlan) return "continue";
      const prior = pendingPlan;
      const mode = cmd.mode;
      yield* agentEvents.send({
        type: "query",
        docId: prior.docId,
        query: prior.query,
        warm: false,
        effort: currentEffort,
        ...(prior.attachments?.length ? { attachments: [...prior.attachments] } : {}),
      });
      yield* startRun(() =>
        runPlannedQuery({
          docId: prior.docId,
          query: prior.query,
          mode,
          wallStartMs: prior.wallStartMs,
          abilityFilter: prior.abilityFilter,
          onStart: () => startRunDir(prior.docId, prior.query, mode, prior.attachments),
          clarify: "none",
          pending: (plan) => ({ ...prior, plan, mode }),
        }),
      );
      return "continue";
    },

    *accept_plan() {
      if (!pendingPlan) return "continue";
      if (pendingPlan.plan.intent === "clarify") {
        // Accepting over a clarify park abandons it.
        yield* abortRun();
        return "continue";
      }
      const accepted = pendingPlan;
      pendingPlan = null;
      startRunDir(accepted.docId, accepted.query, accepted.mode, accepted.attachments);
      yield* startRun(() =>
        runAcceptedPlan({
          query: accepted.query,
          plan: accepted.plan,
          mode: accepted.mode,
          wallStartMs: accepted.wallStartMs,
          abilityFilter: accepted.abilityFilter,
          userSidePending: accepted.userSidePending,
        }),
      );
      return "continue";
    },

    *cancel_plan() {
      yield* abortRun();
      return "continue";
    },

    *edit_plan() {
      yield* abortRun();
      return "continue";
    },

    *update_task_description(cmd) {
      if (pendingPlan) {
        pendingPlan.plan.tasks = pendingPlan.plan.tasks.map((t, i) =>
          i === cmd.index ? { ...t, description: cmd.description } : t,
        );
        yield* agentEvents.send({
          type: "plan:task_updated",
          index: cmd.index,
          description: cmd.description,
        });
      }
      return "continue";
    },

    *add_task(cmd) {
      if (pendingPlan) {
        const insertAt = Math.max(
          0,
          Math.min(pendingPlan.plan.tasks.length, cmd.afterIndex + 1),
        );
        pendingPlan.plan.tasks = [
          ...pendingPlan.plan.tasks.slice(0, insertAt),
          { description: "" },
          ...pendingPlan.plan.tasks.slice(insertAt),
        ];
        yield* agentEvents.send({
          type: "plan:task_added",
          afterIndex: cmd.afterIndex,
        });
      }
      return "continue";
    },

    *delete_task(cmd) {
      if (
        pendingPlan &&
        pendingPlan.plan.tasks.length > 1 &&
        cmd.index >= 0 &&
        cmd.index < pendingPlan.plan.tasks.length
      ) {
        pendingPlan.plan.tasks = pendingPlan.plan.tasks.filter(
          (_, i) => i !== cmd.index,
        );
        yield* agentEvents.send({ type: "plan:task_deleted", index: cmd.index });
      }
      return "continue";
    },

    *move_task(cmd) {
      if (pendingPlan) {
        const n = pendingPlan.plan.tasks.length;
        if (
          cmd.from !== cmd.to &&
          cmd.from >= 0 &&
          cmd.from < n &&
          cmd.to >= 0 &&
          cmd.to < n
        ) {
          const tasks = [...pendingPlan.plan.tasks];
          const [moved] = tasks.splice(cmd.from, 1);
          tasks.splice(cmd.to, 0, moved);
          pendingPlan.plan.tasks = tasks;
          yield* agentEvents.send({
            type: "plan:task_moved",
            from: cmd.from,
            to: cmd.to,
          });
        }
      }
      return "continue";
    },
  };

  // Auto-submit --query on the first iteration, through the same handler an
  // interactive submit uses — one path, one behavior.
  if (runner.isFirstIteration && runner.initialQuery) {
    yield* handle.submit_query({
      type: "submit_query",
      query: runner.initialQuery,
      mode: runner.config().defaults.reasoningMode,
    });
  }

  for (const cmd of yield* each(commands)) {
    // `as never` is the one concession to TS's union-correlation limit —
    // the mapped table above guarantees the handler matches the variant.
    let flow: Flow = "continue";
    try {
      flow = yield* handle[cmd.type](cmd as never);
    } catch (err) {
      // A throwing handler leaves unknown state — abandoning the run/park is
      // the honest reset, and it ANNOUNCES (the fold's stillborn/standing
      // rule applies), then the toast says why.
      yield* abortRun();
      yield* agentEvents.send({ type: "ui:error", message: errorMessage(err) });
    }
    // The exit check must PRECEDE `each.next()`: next() suspends awaiting
    // the NEXT command, and a `return` through a suspending `finally` parks
    // until one arrives — quit would exit one command late (or never).
    if (flow === "exit") return;
    yield* each.next();
  }
}
