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
import type { Context, Operation, Task, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import {
  initAgents,
  WindDown,
  CancelAgent,
  reconstructBranch,
  Pause,
} from "@lloyal-labs/lloyal-agents";
import type {
  Ability,
  AbilityFactory,
  AbilityRegistry,
  AbilityConfigStore,
} from "@lloyal-labs/lloyal-agents";
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
import { RunnerCtx as RigRunnerCtx } from "@lloyal-labs/rig";
import type { Runner } from "@lloyal-labs/rig";
import {
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
import type { ConfigOrigin } from "./config-types.js";

/** The runner ↔ harness seam, typed to THIS harness's config. The context and
 *  the `Runner` machinery are rig's (`makeEdgeRunner` / `makeServedRunner`);
 *  only the `Config`/`ConfigOrigin` shapes are yours, and this cast marries
 *  them — the boots and `pipeline.ts` import it from here. */
export const RunnerCtx = RigRunnerCtx as Context<Runner<Config, ConfigOrigin>>;

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
    const toc = ability.source.promptData()["toc"];
    if (typeof toc === "string" && toc) {
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

// ── The library: settled briefs on disk ──────────────────────────

/** One sidebar entry per run dir that actually settled — error runs leave no
 *  report.md. Title and byline come from the report's own first lines
 *  (`# query` / `> ISO · mode · …`, RunDirSink's format), newest first. */
function listReports(
  outputDir: string,
): { path: string; title: string; savedAt: string; mode: "flat" | "deep" | null }[] {
  if (!fs.existsSync(outputDir)) return [];
  const entries: {
    path: string;
    title: string;
    savedAt: string;
    mode: "flat" | "deep" | null;
  }[] = [];
  for (const name of fs.readdirSync(outputDir)) {
    const reportPath = path.join(outputDir, name, "report.md");
    let text: string;
    try {
      text = fs.readFileSync(reportPath, "utf8");
    } catch {
      continue;
    }
    const [titleLine = "", , metaLine = ""] = text.split("\n");
    const meta = /^> (\S+) · (flat|deep)/.exec(metaLine);
    entries.push({
      path: reportPath,
      title: titleLine.replace(/^#\s*/, "") || name,
      savedAt: meta?.[1] ?? name,
      mode: meta?.[2] === "flat" || meta?.[2] === "deep" ? meta[2] : null,
    });
  }
  return entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
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
      const pdToc = corpusAbility.source.promptData()["toc"];
      const pd = { toc: typeof pdToc === "string" ? pdToc : undefined };
      events.send({
        type: "corpus:indexed",
        corpusPath: String(corpusBootCfg.corpusPath ?? ""),
        fileCount: pd?.toc ? pd.toc.split("\n").filter(Boolean).length : 0,
        chunkCount: 0,
      });
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

  function startRunDir(query: string, mode: "flat" | "deep"): void {
    const outputDir = runner.config().sources.outputDir ?? process.cwd();
    runDirSink.start({ outputDir, query, mode });
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
      const pdToc = ability.source.promptData()["toc"];
      events.send({
        type: "corpus:indexed",
        corpusPath: String(cfg.corpusPath ?? ""),
        fileCount:
          typeof pdToc === "string" && pdToc
            ? pdToc.split("\n").filter(Boolean).length
            : 0,
        chunkCount: 0,
      });
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
    if (registry.enabled().length === 0) {
      throw new HarnessExit(
        "No source configured. Enable an ability in harness/harness.ts — the web ability runs keyless.",
        2,
      );
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

  // ── Ink TTY command loop ───────────────────────────────────

  // Per-query run effort, set at submit_query and read by every research path.
  let currentEffort: Effort = runner.config().defaults.effort;
  let pendingPlan: {
    plan: PlanResult;
    query: string;
    clarifyExchanged: boolean;
    mode: "flat" | "deep";
    wallStartMs: number;
    abilityFilter: readonly string[];
  } | null = null;

  // ── Run-in-fiber (Stop escape hatch) ───────────────────────
  // The heavy operations run in a CHILD fiber so the command loop keeps polling
  // `each(commands)` while a run is in flight. `stop` halts the held Task.
  let runTask: Task<void> | null = null;
  // Lifecycle sequencing is the harness's job (the pool holds regardless):
  // pause only while plainly running; wrap_up refused while paused; both
  // flags reset when the run ends or is stopped.
  let paused = false;
  let woundDown = false;

  function* startRun(
    body: (clearIfCurrent: () => void) => Operation<void>,
  ): Operation<void> {
    if (runTask) yield* haltRun();
    // A NEW run never inherits the old run's lifecycle flags. The halted
    // task's clearIfCurrent cannot reset them (haltRun already nulled
    // runTask, so its guard fails) — reset here, where the run begins.
    paused = false;
    woundDown = false;
    const task = yield* spawn(() =>
      body(() => {
        if (runTask === task) { runTask = null; paused = false; woundDown = false; }
      }),
    );
    runTask = task;
  }

  function* haltRun(): Operation<void> {
    const task = runTask;
    runTask = null;
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

  // Auto-submit --query only on the first iteration.
  if (runner.isFirstIteration && runner.initialQuery) {
    const mode = runner.config().defaults.reasoningMode;
    const wallStartMs = performance.now();
    const submissionFilter = currentAbilityFilter();
    const result = yield* runQuery(runner.initialQuery, session, {
      ...harnessOpts,
      reasoningMode: mode,
      wallStartMs,
      abilityFilter: submissionFilter,
      onStart: () => startRunDir(runner.initialQuery!, mode),
    });
    if (result.type === "research_plan") {
      pendingPlan = {
        plan: result.plan,
        query: runner.initialQuery,
        clarifyExchanged: false,
        mode,
        wallStartMs,
        abilityFilter: submissionFilter,
      };
      yield* agentEvents.send({ type: "ui:plan_review" });
    } else if (result.type === "clarify") {
      yield* call(() =>
        session.commitTurn(
          runner.initialQuery!,
          formatClarifyAsAssistantMsg(result.plan.clarifyQuestions),
        ),
      );
      pendingPlan = {
        plan: result.plan,
        query: runner.initialQuery,
        clarifyExchanged: false,
        mode,
        wallStartMs,
        abilityFilter: submissionFilter,
      };
    } else {
      yield* agentEvents.send({ type: "ui:composer" });
    }
  }

  for (const cmd of yield* each(commands)) {
    try {
      if (cmd.type === "quit") return;

      if (cmd.type === "stop") {
        if (runTask) {
          yield* haltRun();
          paused = false;
          woundDown = false;
          pendingPlan = null;
          yield* agentEvents.send({ type: "ui:composer" });
        }
        continue;
      }

      if (cmd.type === "wrap_up") {
        // Refused while paused — press play first (the pane disables the
        // button; this guard covers raw wire clients).
        if (runTask && !paused) {
          woundDown = true;
          runner.windDown.send();
        }
        continue;
      }

      if (cmd.type === "pause") {
        if (runTask && !paused && !woundDown) {
          paused = true;
          runner.pauseRun.send(true);
        }
        continue;
      }

      if (cmd.type === "resume") {
        if (paused) {
          paused = false;
          runner.pauseRun.send(false);
        }
        continue;
      }

      if (cmd.type === "cancel_agent") {
        if (runTask) runner.cancelAgent.send({ agentId: cmd.agentId });
        continue;
      }

      if (cmd.type === "set_model_path") {
        runner.reloadRuntime({ model: { path: cmd.path } });
        return;
      }

      if (cmd.type === "set_reranker_path") {
        runner.reloadRuntime({ model: { reranker: cmd.path } });
        return;
      }

      if (cmd.type === "set_gpu") {
        runner.reloadRuntime({ model: { gpu: cmd.gpu } });
        return;
      }

      if (cmd.type === "toggle_participation") {
        const current = participation[cmd.name] ?? true;
        participation[cmd.name] = !current;
        yield* agentEvents.send({
          type: "participation:toggled",
          name: cmd.name,
        });
        continue;
      }

      if (cmd.type === "set_ability_config") {
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
          continue;
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
              const pd = (
                ability.source as { promptData?: () => { toc?: string } }
              ).promptData?.();
              if (pd?.toc !== undefined) {
                events.send({
                  type: "corpus:indexed",
                  corpusPath: String(resolvedValues.corpusPath ?? ""),
                  fileCount: pd.toc
                    ? pd.toc.split("\n").filter(Boolean).length
                    : 0,
                  chunkCount: 0,
                });
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
              continue;
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
      } else if (cmd.type === "set_output_dir") {
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
      } else if (cmd.type === "library_list") {
        yield* agentEvents.send({
          type: "library:list",
          entries: listReports(libraryDir()),
        });
      } else if (cmd.type === "library_read") {
        // Reads are confined to the library: a report.md under the output
        // dir, nothing else — the wire never becomes an arbitrary file read.
        const root = path.resolve(libraryDir());
        const resolved = path.resolve(cmd.path);
        const confined =
          resolved.startsWith(root + path.sep) &&
          path.basename(resolved) === "report.md";
        if (!confined || !fs.existsSync(resolved)) {
          yield* agentEvents.send({
            type: "ui:error",
            message: "That report is no longer there.",
          });
        } else {
          yield* agentEvents.send({
            type: "library:report",
            path: cmd.path,
            body: fs.readFileSync(resolved, "utf8"),
          });
        }
      } else if (cmd.type === "set_effort") {
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
      } else if (cmd.type === "submit_query") {
        if (registry.enabled().length === 0) {
          yield* agentEvents.send({
            type: "ui:error",
            message: "No source configured. Add Tavily key or corpus path.",
          });
          continue;
        }
        if (currentAbilityFilter().length === 0) {
          yield* agentEvents.send({
            type: "ui:error",
            message:
              "All sources excluded. Tab to a chip and press Space to include at least one.",
          });
          continue;
        }
        const wallStartMs = performance.now();
        currentEffort = runner.config().defaults.effort;
        if (runTask) {
          yield* haltRun();
          pendingPlan = null;
        }
        if (cmd.skipPlanner) {
          const plan = singleTaskPlan(cmd.query);
          // `query` first, matching runPlanner's order — the fold's warm-ask
          // branch must see the ask before the synthetic plan:start arrives,
          // or the plan:start retitles the settled document.
          yield* agentEvents.send({
            type: "query",
            query: cmd.query,
            warm: !!session.trunk,
          });
          yield* agentEvents.send({
            type: "plan:start",
            query: cmd.query,
            mode: cmd.mode,
          });
          yield* agentEvents.send({
            type: "plan",
            intent: plan.intent,
            tasks: plan.tasks,
            clarifyQuestions: plan.clarifyQuestions,
            tokenCount: plan.tokenCount,
            timeMs: plan.timeMs,
          });
          const submissionFilter = currentAbilityFilter();
          startRunDir(cmd.query, cmd.mode);
          yield* startRun(function* (clearIfCurrent) {
            try {
              yield* runResearchPlan(cmd.query, plan, session, {
                ...harnessOpts,
                reasoningMode: cmd.mode,
                effort: currentEffort,
                wallStartMs,
                abilityFilter: submissionFilter,
                isAsk: cmd.skipPlanner,
              });
              yield* reindexCorpus();
              yield* agentEvents.send({ type: "ui:composer" });
            } catch (err) {
              yield* agentEvents.send({
                type: "ui:error",
                message: errorMessage(err),
              });
            } finally {
              clearIfCurrent();
            }
          });
          continue;
        }
        const submissionFilter = currentAbilityFilter();
        const queryText = cmd.query;
        const queryMode = cmd.mode;
        yield* startRun(function* (clearIfCurrent) {
          try {
            const result = yield* runQuery(queryText, session, {
              ...harnessOpts,
              reasoningMode: queryMode,
              effort: currentEffort,
              context: buildPlannerContext(registry.enabled()),
              wallStartMs,
              abilityFilter: submissionFilter,
              onStart: () => startRunDir(queryText, queryMode),
            });
            if (result.type === "research_plan") {
              pendingPlan = {
                plan: result.plan,
                query: queryText,
                clarifyExchanged: false,
                mode: queryMode,
                wallStartMs,
                abilityFilter: submissionFilter,
              };
              yield* agentEvents.send({ type: "ui:plan_review" });
            } else if (result.type === "clarify") {
              yield* call(() =>
                session.commitTurn(
                  queryText,
                  formatClarifyAsAssistantMsg(result.plan.clarifyQuestions),
                ),
              );
              pendingPlan = {
                plan: result.plan,
                query: queryText,
                clarifyExchanged: false,
                mode: queryMode,
                wallStartMs,
                abilityFilter: submissionFilter,
              };
            } else {
              yield* reindexCorpus();
              yield* agentEvents.send({ type: "ui:composer" });
            }
          } catch (err) {
            pendingPlan = null;
            yield* agentEvents.send({
              type: "ui:error",
              message: errorMessage(err),
            });
          } finally {
            clearIfCurrent();
          }
        });
      } else if (cmd.type === "submit_clarification" && pendingPlan) {
        const { query: origQuery, mode, wallStartMs, abilityFilter } = pendingPlan;
        const priorPlan = pendingPlan;
        yield* call(() => session.prefillUser(cmd.answer));
        yield* startRun(function* (clearIfCurrent) {
          try {
            const result = yield* runQuery(origQuery, session, {
              ...harnessOpts,
              reasoningMode: mode,
              effort: currentEffort,
              context: buildPlannerContext(registry.enabled()),
              wallStartMs,
              abilityFilter,
              onStart: () => startRunDir(origQuery, mode),
            });
            if (result.type === "research_plan") {
              pendingPlan = {
                ...priorPlan,
                plan: result.plan,
                clarifyExchanged: true,
              };
              yield* agentEvents.send({ type: "ui:plan_review" });
            } else if (result.type === "clarify") {
              yield* call(() =>
                session.prefillAssistant(
                  formatClarifyAsAssistantMsg(result.plan.clarifyQuestions),
                ),
              );
              pendingPlan = {
                ...priorPlan,
                plan: result.plan,
                clarifyExchanged: true,
              };
            } else {
              pendingPlan = null;
              yield* reindexCorpus();
              yield* agentEvents.send({ type: "ui:composer" });
            }
          } catch (err) {
            pendingPlan = null;
            yield* agentEvents.send({
              type: "ui:error",
              message: errorMessage(err),
            });
          } finally {
            clearIfCurrent();
          }
        });
      } else if (cmd.type === "change_mode" && pendingPlan) {
        const priorPlan = pendingPlan;
        const nextMode = cmd.mode;
        yield* startRun(function* (clearIfCurrent) {
          try {
            const result = yield* runQuery(priorPlan.query, session, {
              ...harnessOpts,
              reasoningMode: nextMode,
              effort: currentEffort,
              context: buildPlannerContext(registry.enabled()),
              wallStartMs: priorPlan.wallStartMs,
              abilityFilter: priorPlan.abilityFilter,
              onStart: () => startRunDir(priorPlan.query, nextMode),
            });
            if (result.type === "research_plan") {
              pendingPlan = { ...priorPlan, plan: result.plan, mode: nextMode };
              yield* agentEvents.send({ type: "ui:plan_review" });
            } else if (result.type === "clarify") {
              pendingPlan = { ...priorPlan, plan: result.plan, mode: nextMode };
            } else {
              pendingPlan = null;
              yield* reindexCorpus();
              yield* agentEvents.send({ type: "ui:composer" });
            }
          } catch (err) {
            pendingPlan = null;
            yield* agentEvents.send({
              type: "ui:error",
              message: errorMessage(err),
            });
          } finally {
            clearIfCurrent();
          }
        });
      } else if (cmd.type === "accept_plan" && pendingPlan) {
        if (pendingPlan.plan.intent === "clarify") {
          pendingPlan = null;
          yield* agentEvents.send({ type: "ui:composer" });
          continue;
        }
        if (registry.enabled().length === 0) {
          yield* agentEvents.send({
            type: "ui:error",
            message: "No source configured. Add Tavily key or corpus path.",
          });
          pendingPlan = null;
          continue;
        }
        startRunDir(pendingPlan.query, pendingPlan.mode);
        const acceptedPlan = pendingPlan;
        pendingPlan = null;
        yield* startRun(function* (clearIfCurrent) {
          try {
            yield* runResearchPlan(
              acceptedPlan.query,
              acceptedPlan.plan,
              session,
              {
                ...harnessOpts,
                reasoningMode: acceptedPlan.mode,
                effort: currentEffort,
                wallStartMs: acceptedPlan.wallStartMs,
                abilityFilter: acceptedPlan.abilityFilter,
                userSidePending: acceptedPlan.clarifyExchanged,
              },
            );
            yield* reindexCorpus();
            yield* agentEvents.send({ type: "ui:composer" });
          } catch (err) {
            yield* agentEvents.send({
              type: "ui:error",
              message: errorMessage(err),
            });
          } finally {
            clearIfCurrent();
          }
        });
      } else if (cmd.type === "cancel_plan") {
        pendingPlan = null;
        yield* agentEvents.send({ type: "ui:composer" });
      } else if (cmd.type === "edit_plan") {
        pendingPlan = null;
        yield* agentEvents.send({ type: "ui:composer", prefill: cmd.query });
      } else if (cmd.type === "update_task_description" && pendingPlan) {
        pendingPlan.plan.tasks = pendingPlan.plan.tasks.map((t, i) =>
          i === cmd.index ? { ...t, description: cmd.description } : t,
        );
        yield* agentEvents.send({
          type: "plan:task_updated",
          index: cmd.index,
          description: cmd.description,
        });
      } else if (cmd.type === "add_task" && pendingPlan) {
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
      } else if (cmd.type === "delete_task" && pendingPlan) {
        if (pendingPlan.plan.tasks.length > 1) {
          pendingPlan.plan.tasks = pendingPlan.plan.tasks.filter(
            (_, i) => i !== cmd.index,
          );
          yield* agentEvents.send({
            type: "plan:task_deleted",
            index: cmd.index,
          });
        }
      } else if (cmd.type === "move_task" && pendingPlan) {
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
    } catch (err) {
      pendingPlan = null;
      yield* agentEvents.send({ type: "ui:error", message: errorMessage(err) });
    } finally {
      yield* each.next();
    }
  }
  return;
}
