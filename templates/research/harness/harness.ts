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
 * SNAPSHOT: reasoning.run @ 0.8.0 — a curated separate copy of its pipeline,
 * conforming to the lloyal new conventions. Drift from upstream is
 * expected and accepted.
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
  Attachments,
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
import type { AbilityDescriptor } from "./state.js";
import { RunDirSink } from "./run-dir.js";
import { resolvePath } from "@lloyal-labs/rig/node";
import { RunnerCtx } from "./runner-ctx.js";
import { confinedReport, listReports, readReport, removeReport } from "./library.js";
import type { ConfigOrigin } from "./config-types.js";

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

/** Resolve path-shaped string values in an ability-config object at the UI→harness
 *  boundary — no per-ability name knowledge. A value is a path when its key ends in
 *  "Path" or the string starts with ~ / . */
function resolveConfigPaths(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (
      typeof value === "string" &&
      value !== "" &&
      (/path$/i.test(key) || /^[~/.]/.test(value))
    ) {
      out[key] = resolvePath(value);
    } else {
      out[key] = value;
    }
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
// Manifest-only (the ability-catalog fetch was stripped from this template — no
// hardcoded apps.lloyal.ai URL in a scaffold, and the austere views have no
// Settings drawer). One descriptor per registry-ENABLED ability, built from the
// ability's OWN manifest. Display-only; forwarded to the renderer via `abilities:state`.
// The catalog-metadata join (title/iconUrl/entitlements) reasoning.run does is
// intentionally absent here.

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

/** A planner result held for review. Carried whole between the plan-review
 *  commands (edit, change-mode, clarify, accept) so a re-plan keeps the
 *  submission's own clock, filter, and clarify history. */
interface PendingPlan {
  plan: PlanResult;
  query: string;
  /** The user side of the next trunk turn is ALREADY prefilled, so the run
   *  must close with `prefillAssistant` rather than `commitTurn` (which would
   *  re-emit it). Two things set it: a clarify round (`prefillUser`), and a
   *  query that arrived with images (`prefillUserMultimodal`). Named for the
   *  state, not for either cause — it was `clarifyExchanged` when a clarify
   *  round was the only way to reach it. */
  userSidePending: boolean;
  mode: "flat" | "deep";
  wallStartMs: number;
  abilityFilter: readonly string[];
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
  events.send({ type: "ui:composer" });

  const harnessOpts = {
    maxTurns: MAX_TOOL_TURNS,
    findingsMaxChars: runner.findingsMaxChars,
    reasoningMode: runner.config().defaults.reasoningMode,
    effort: runner.config().defaults.effort,
  };

  function startRunDir(
    query: string,
    mode: "flat" | "deep",
    attached: readonly Descriptor[] = [],
  ): void {
    const outputDir = runner.config().sources.outputDir ?? process.cwd();
    runDirSink.start({
      outputDir,
      query,
      mode,
      attachments: attached.map((a) => a.digest),
    });
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
    const result = yield* runQuery(runner.initialQuery, session, {
      ...harnessOpts,
      wallStartMs,
      onStart: () =>
        startRunDir(runner.initialQuery!, runner.config().defaults.reasoningMode),
    });
    if (result.type === "clarify") {
      throw new HarnessExit(
        "Planner asked clarifying questions; non-TTY mode can't answer. Aborting.",
        2,
      );
    }
    if (result.type === "research_plan") {
      startRunDir(runner.initialQuery, runner.config().defaults.reasoningMode);
      yield* runResearchPlan(runner.initialQuery, result.plan, session, {
        ...harnessOpts,
        wallStartMs,
      });
    }
    return;
  }

  // ── The command loop — every interactive surface ───────────

  // Per-query run effort, set at submit_query and read by every research path.
  let currentEffort: Effort = runner.config().defaults.effort;
  // The library report currently restored as the session document (set by
  // library_read, consumed by the first submit over it), and the reports
  // already committed to the trunk — a report prefills once; later asks
  // over it are simply warm.
  let openedReport: ReturnType<typeof readReport> | null = null;
  const committedReports = new Set<string>();
  let pendingPlan: PendingPlan | null = null;

  // ── The run lifecycle — ONE place ──────────────────────────
  // The heavy operations run in a CHILD fiber so the command loop keeps
  // polling `each(commands)` while a run is in flight. startRun/haltRun own
  // every transition of these three fields; nothing else writes them. A NEW
  // run never inherits the old run's flags — startRun resets them, and the
  // fiber's own finally clears them only while it is still the current run.
  const run: { task: Task<void> | null; paused: boolean; woundDown: boolean } = {
    task: null,
    paused: false,
    woundDown: false,
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

  // First submit over a restored report: commit it to the trunk — its
  // prefill is the ask's warmup; from here the warm-ask and extend paths
  // need no special handling at all.
  function* commitOpenedReport(): Operation<void> {
    if (openedReport === null) return;
    if (!committedReports.has(openedReport.path)) {
      committedReports.add(openedReport.path);
      const { title, body } = openedReport;
      yield* call(() => session.commitTurn(title, body));
    }
    openedReport = null;
  }

  /** Run the planner and route its outcome — the ONE shape submit_query,
   *  submit_clarification, and change_mode share. What differs per caller:
   *  how a clarify message reaches the trunk, and what a returned plan
   *  becomes as the pending plan. A finished run reindexes the corpus and
   *  returns to the composer; an error clears the pending plan and toasts. */
  function* runPlannedQuery(spec: {
    query: string;
    mode: "flat" | "deep";
    wallStartMs: number;
    abilityFilter: readonly string[];
    attachments?: readonly Descriptor[];
    onStart: () => void;
    clarify: "commit" | "prefill" | "none";
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
        attachments: spec.attachments,
        onStart: spec.onStart,
      });
      if (result.type === "research_plan") {
        pendingPlan = spec.pending(result.plan);
        yield* agentEvents.send({ type: "ui:plan_review" });
      } else if (result.type === "clarify") {
        const msg = formatClarifyAsAssistantMsg(result.plan.clarifyQuestions);
        if (spec.clarify === "commit") {
          yield* call(() => session.commitTurn(spec.query, msg));
        } else if (spec.clarify === "prefill") {
          yield* call(() => session.prefillAssistant(msg));
        }
        pendingPlan = spec.pending(result.plan);
      } else {
        pendingPlan = null;
        yield* reindexCorpus();
        yield* agentEvents.send({ type: "ui:composer" });
      }
    } catch (err) {
      pendingPlan = null;
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
      yield* agentEvents.send({ type: "ui:composer" });
    } catch (err) {
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
      if (run.task) {
        yield* haltRun();
        run.paused = false;
        run.woundDown = false;
        pendingPlan = null;
        yield* agentEvents.send({ type: "ui:composer" });
      }
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

    // Boot-phase commands: answered by the target's boot BEFORE this loop
    // runs (the download/decline dialog). Ignored here by decision, not
    // omission — the table stays exhaustive.
    *accept_backend_pack() {
      return "continue";
    },
    *decline_backend_pack() {
      return "continue";
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
        ([k, v]) =>
          typeof v === "string" &&
          v !== "" &&
          (/path$/i.test(k) || /^[~/.]/.test(v)) &&
          !fs.existsSync(v),
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

      yield* agentEvents.send({
        type: "config:updated",
        config: redactAbilities(saved.config),
        origin: saved.origin,
        savedTo: saved.path,
        gitignored: saved.gitignored,
        skipped: saved.skipped,
      });
      yield* emitAbilities();
      return "continue";
    },

    *set_output_dir(cmd) {
      const resolved = cmd.path ? resolvePath(cmd.path) : "";
      const saved = runner.saveConfig({
        sources: { outputDir: resolved },
      });
      yield* agentEvents.send({
        type: "config:updated",
        config: redactAbilities(saved.config),
        origin: saved.origin,
        savedTo: saved.path,
        gitignored: saved.gitignored,
        skipped: saved.skipped,
      });
      return "continue";
    },

    *set_effort(cmd) {
      // Save ONLY the changed key — spreading the whole defaults object
      // would pin the untouched ones into harness.json, shadowing later
      // harness.yml edits.
      const saved = runner.saveConfig({ defaults: { effort: cmd.effort } });
      yield* agentEvents.send({
        type: "config:updated",
        config: redactAbilities(saved.config),
        origin: saved.origin,
        savedTo: saved.path,
        gitignored: saved.gitignored,
        skipped: saved.skipped,
      });
      return "continue";
    },

    *new_run() {
      // A run in flight is abandoned the same way a fresh submit abandons it.
      if (run.task) {
        yield* haltRun();
        pendingPlan = null;
      }
      // Drop the restored-report binding: the next submit must not commit a
      // document the user has just cleared.
      openedReport = null;
      yield* agentEvents.send({ type: "ui:new_run" });
      return "continue";
    },

    *library_list() {
      yield* agentEvents.send({
        type: "library:list",
        entries: listReports(libraryDir()),
      });
      return "continue";
    },

    *library_read(cmd) {
      // Confined to the library (confinedReport — realpath both sides).
      // RESTORES the report as the session's settled document — the
      // standard query/answer/complete events seed the fold, so everything
      // downstream (canvas, chips, Ask, Extend) is the fresh-settle path.
      // The trunk commit waits for the first submit over it.
      const resolved = confinedReport(libraryDir(), cmd.path);
      if (resolved === null) {
        yield* agentEvents.send({
          type: "ui:error",
          message: "That report is no longer there.",
        });
      } else if (run.task) {
        yield* agentEvents.send({
          type: "ui:error",
          message: "A brief is in flight — close it before opening another.",
        });
      } else {
        openedReport = readReport(resolved);
        // The report kept the ADDRESSES; the store kept the content. Rebuild
        // each descriptor from what is actually on disk rather than trusting
        // the file — a digest whose manifest is gone is dropped, so the brief
        // reopens without a figure instead of with a broken one.
        const contentStore = yield* Attachments.expect();
        const restored: Descriptor[] = [];
        for (const digest of openedReport.attachments) {
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
          type: "query",
          query: openedReport.title,
          warm: false,
          ...(restored.length > 0 ? { attachments: restored } : {}),
        });
        yield* agentEvents.send({ type: "answer", text: openedReport.body });
        yield* agentEvents.send({ type: "complete", data: {} });
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
      // context; the pool registers whichever abilities ARE included, and none
      // is simply the empty union.
      const abilityFilter = currentAbilityFilter();
      const wallStartMs = performance.now();
      currentEffort = runner.config().defaults.effort;
      if (run.task) {
        yield* haltRun();
        pendingPlan = null;
      }
      yield* commitOpenedReport();
      const { query, mode } = cmd;

      // Attached images land on the TRUNK before either path below runs. That
      // ordering is the point: agents fork from the trunk, so one encode is
      // shared by every one of them instead of copied per agent. It also means
      // the user side of this turn is already committed — hence
      // `userSidePending`, which makes the run close with `prefillAssistant`
      // instead of re-emitting the query via `commitTurn`.
      let userSidePending = false;
      // Hoisted: the `query` event both seeds and RESETS the fold, and it is
      // emitted from two paths below, so the roots must outlive this block.
      let attachments: readonly Descriptor[] = [];
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
        // The bytes were admitted at the content plane on the way in, so there
        // is nothing to ingest here — only to resolve. Two checks, two
        // questions: `asAttachment` refuses a descriptor that is not the KIND
        // of thing that can be a root, and `materialize` refuses one the store
        // has never seen. Neither is a formality — a descriptor on this wire is
        // a claim, not proof.
        const contentStore = yield* Attachments.expect();
        const roots = cmd.attachments.map(asAttachment);
        if (roots.some((r) => r === null)) {
          yield* agentEvents.send({
            type: "ui:error",
            message: "That attachment reference isn't an image the host admitted.",
          });
          return "continue";
        }
        let prepared;
        try {
          prepared = materialize(contentStore, roots as Attachment[]);
        } catch (err) {
          yield* agentEvents.send({
            type: "ui:error",
            message: `Couldn't read that image back: ${errorMessage(err)}`,
          });
          return "continue";
        }
        // Prefilled onto the TRUNK once; every agent forked from it attends the
        // same cells. N agents cost one projection, not N.
        yield* call(() => session.prefillUserMultimodal(
          query,
          prepared.bitmaps as Uint8Array[],
          { attachments: prepared.attachments },
        ));
        attachments = prepared.attachments;
        userSidePending = true;
      }

      // Ask (skipPlanner): the user's question IS the plan — one warm task,
      // no planner. `query` first, matching runPlanner's order: the fold's
      // warm-ask branch must see the ask before the synthetic plan:start
      // arrives, or the plan:start retitles the settled document.
      if (cmd.skipPlanner) {
        const plan = singleTaskPlan(query);
        yield* agentEvents.send({
          type: "query",
          query,
          warm: !!session.trunk,
          direct: true,
          ...(attachments.length ? { attachments: [...attachments] } : {}),
        });
        yield* agentEvents.send({ type: "plan:start", query, mode });
        yield* agentEvents.send({
          type: "plan",
          intent: plan.intent,
          tasks: plan.tasks,
          clarifyQuestions: plan.clarifyQuestions,
          tokenCount: plan.tokenCount,
          timeMs: plan.timeMs,
        });
        startRunDir(query, mode, attachments);
        yield* startRun(() =>
          runAcceptedPlan({ query, plan, mode, wallStartMs, abilityFilter, isAsk: true, userSidePending }),
        );
        return "continue";
      }

      yield* startRun(() =>
        runPlannedQuery({
          query,
          mode,
          wallStartMs,
          abilityFilter,
          attachments,
          onStart: () => startRunDir(query, mode, attachments),
          clarify: "commit",
          pending: (plan) => ({
            plan,
            query,
            userSidePending,
            mode,
            wallStartMs,
            abilityFilter,
          }),
        }),
      );
      return "continue";
    },

    *submit_clarification(cmd) {
      if (!pendingPlan) return "continue";
      const prior = pendingPlan;
      yield* call(() => session.prefillUser(cmd.answer));
      yield* startRun(() =>
        runPlannedQuery({
          query: prior.query,
          mode: prior.mode,
          wallStartMs: prior.wallStartMs,
          abilityFilter: prior.abilityFilter,
          onStart: () => startRunDir(prior.query, prior.mode),
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
      yield* startRun(() =>
        runPlannedQuery({
          query: prior.query,
          mode,
          wallStartMs: prior.wallStartMs,
          abilityFilter: prior.abilityFilter,
          onStart: () => startRunDir(prior.query, mode),
          clarify: "none",
          pending: (plan) => ({ ...prior, plan, mode }),
        }),
      );
      return "continue";
    },

    *accept_plan() {
      if (!pendingPlan) return "continue";
      if (pendingPlan.plan.intent === "clarify") {
        pendingPlan = null;
        yield* agentEvents.send({ type: "ui:composer" });
        return "continue";
      }
      const accepted = pendingPlan;
      pendingPlan = null;
      startRunDir(accepted.query, accepted.mode);
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
      pendingPlan = null;
      yield* agentEvents.send({ type: "ui:composer" });
      return "continue";
    },

    *edit_plan(cmd) {
      pendingPlan = null;
      yield* agentEvents.send({ type: "ui:composer", prefill: cmd.query });
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
    try {
      // `as never` is the one concession to TS's union-correlation limit —
      // the mapped table above guarantees the handler matches the variant.
      const flow = yield* handle[cmd.type](cmd as never);
      if (flow === "exit") return;
    } catch (err) {
      pendingPlan = null;
      yield* agentEvents.send({ type: "ui:error", message: errorMessage(err) });
    } finally {
      yield* each.next();
    }
  }
}
