/**
 * How a brief is researched: what the model does. Three operations, each taking the trunk and the ask and
 * RETURNING a value — none writes the trunk, and the brief decides what is done with what comes back.
 *
 *   plan     asks what each source covers, then the planner, and returns the plan
 *   write    runs the plan's inquiries on one shared spine, settles them into one answer, and returns it
 *   answer   answers straight from the trunk: one agent, one turn, on a fork of the conversation so far
 *
 * The part worth seeing is in `write`. Every inquiry forks from ONE spine, so the shared header and the sources'
 * tools are paid for once however many agents run; and how the inquiries run beside each other is a single
 * expression, `inquire`. Replace any stage by handing `write` your own.
 */
import type { Operation } from "effection";
import type { Branch } from "@lloyal-labs/sdk";
import { Ctx, agentPool, useAgent, chain, parallel, withSpine } from "@lloyal-labs/lloyal-agents";
import type { Ability, Budget, GuardOverrides, NudgeInput, Orchestrator, PoolContext, PromptOf, SpawnSpec, ToolLifecycleHooks } from "@lloyal-labs/lloyal-agents";
import type { Attachment, Descriptor } from "@lloyal-labs/media";
import {
  PlanTool, abilityToc, citedReport, coverage as probe, participating,
  renderAgentPreamble, renderSpine, singleTaskPlan, taskKey, taskToContent, useWire,
} from "@lloyal-labs/rig";
import type { Coverage, Output, PlanResult, Reports, ResearchTask } from "@lloyal-labs/rig";
import { BUDGETS } from "./budgets.js";
import type { Effort } from "./budgets.js";
import { prompt, render } from "./prompts.js";
import type { CompleteData, DocId, Mode, WorkflowEvent } from "../brief/protocol.js";

/** An ask, as the brief hands it over. */
export type Inputs = {
  docId: DocId;
  text: string;
  mode: Mode;
  /** The question is the plan: one agent, every source's tools, prose accepted as the answer. */
  direct: boolean;
  effort: Effort;
  /** This ask's own pictures and documents. */
  attachments: Descriptor[];
  /** Sources the reader switched off, by name. */
  excluded: string[];
  /** Everything the thread can read from: the brief's recorded roots, this ask's included. */
  sources: Attachment[];
  /** This harness's scope for the sources' gates (`defaults.guards`). */
  guards?: GuardOverrides;
};

export type Stats = { ctxPct: number; ctxPos: number; ctxTotal: number };
/** What a writing produced. `answer` is the brief — or null when the inquiries found nothing to settle: the
 *  view says so; nothing is invented, committed or kept. `inquiries` is what each line of inquiry found, in
 *  plan order: the library keeps one annexure for each that found something, so a writer that ran none returns
 *  none. `stats` and `complete` are what the run bar and the dev pane are told as the run ends. */
export type Written = { answer: string | null; inquiries: { task: string; findings: string }[]; stats: Stats; complete: CompleteData };
/** What the brief is handed: the planner, the writer, and how the writer's inquiries hand in their findings,
 *  which is what lets the view show them. Replace `write`'s `output` and you replace `reports` with it. */
export type Research = { plan: typeof plan; write: typeof write; reports?: Reports };
/** The writer's stages. Each defaults to this file's own; hand `write` one to replace it alone. `output` is
 *  an output whose `read` yields the findings as text — research's contract. */
export type Stages = { answer: typeof answer; inquire: typeof inquire; settle: typeof settle; output: Output<string> };
/** What the inquiries found, as it is handed to the settling stage: each task's findings in plan order, and the
 *  one fact only the run can establish — whether the spine already holds them. The settling agent is a fork of the
 *  spine, so findings the strategy committed there are ATTENDED already and saying them again costs their length
 *  twice; findings it did not commit are nowhere the agent can see unless the prompt carries them. That depends on
 *  the strategy that ran, never on the shape the reader chose. */
export type Evidence = { findings: readonly string[]; attended: boolean };

/** One task's spawn, made for the strategy that asks. `beside` says its siblings work at the same time, which
 *  is what the agent is told about them. */
export type SpecFor = (task: ResearchTask, index: number, beside: boolean) => SpawnSpec;

/** How this file's inquiries hand in: rig's cited report, whose findings are its `result`. */
export const reports: Reports = { tool: citedReport.tool.name, field: "result" };

/** Said once to an inquiry that reports before it has looked anything up. */
export const EVIDENCE_REJECTION = "You must use tools before submitting results.";
/** The evidence floor a research agent keeps: a first report short of it is refused once, then stands. */
const EVIDENCE_FIRST: ToolLifecycleHooks = {
  onReturn: ({ agent }) =>
    agent.toolCallCount < BUDGETS.evidence ? { type: "reject", message: EVIDENCE_REJECTION } : undefined,
};

/** What an agent is told when it must wind its work up. The framework says why (`reason`) and how much room
 *  is left (`words`); the sentence is this app's. Said to an inquiry with a report tool and at least one tool
 *  call behind it; without these words the framework would drop the result or end the turn instead. */
const NUDGE = ({ reason, words }: NudgeInput): string =>
  reason === "result" ? `Tool result too large for the remaining context. Report your findings now within ${words} words.`
  : reason === "time" ? `Time limit reached — report your findings now within ${words} words.`
  : reason === "turns" ? `Turn limit reached — report your findings now within ${words} words.`
  : `Context nearly full — report your findings now within ${words} words.`;

const today = (): string => new Date().toISOString().slice(0, 10);
const timer = (): (() => number) => { const t = performance.now(); return () => performance.now() - t; };

/** What the planner is told beside the query: each source it may route to, and what a probe found each covers. */
const sourcesFor = (sources: readonly Ability[], attachments: readonly Attachment[]) =>
  sources.map((source) => ({ name: source.manifest.protocol.name, useWhen: source.manifest.protocol.useWhen, toc: abilityToc(source, attachments) }));

/** What each source covers for this ask (remembered in `coverage` for the session), then the planner. The plan
 *  is returned; the brief says it on the wire. A planner of your own needs nothing else. This one also probes:
 *  `preflight:start` moves the canvas to "browsing your sources" and `preflight:done` moves it back, so whatever
 *  says the first must say the second. A planner that probes nothing says neither. */
export function* plan(trunk: Branch | null, ask: Inputs, coverage: Map<string, Coverage>): Operation<PlanResult> {
  const wire = yield* useWire<WorkflowEvent>();
  const sources = yield* participating(ask.excluded, ask.sources);
  // With two or more sources there is routing to do: one probe per source, once per ask and asset set.
  let covered = "";
  if (sources.length >= 2) {
    const key = [ask.text, sources.map((s) => s.manifest.name).sort().join(","), ask.sources.map((a) => a.digest).sort().join(",")].join("|");
    let found = coverage.get(key);
    if (!found) {
      yield* wire.send({ type: "preflight:start", query: ask.text, abilityCount: sources.length });
      found = yield* probe({
        query: ask.text, sources, parent: trunk ?? undefined, prompt: (input) => prompt("preflight", input),
        budget: { ...BUDGETS.recon, recovery: { prompt: (input) => prompt("preflight-recover", input), ...BUDGETS.recon.recovery } },
        guards: ask.guards, hooks: [EVIDENCE_FIRST], reference: ask.sources,
      });
      coverage.set(key, found);
      yield* wire.send({ type: "preflight:done", coverage: found.coverage, tokens: found.tokens, toolCalls: found.toolCalls, timeMs: found.timeMs });
    }
    covered = found.coverage;
  }
  const planner = new PlanTool({
    // The tool says what it owns (the query, the task cap, the routing key); this app adds the day, the sources
    // and what the probe found — the template writes those sections.
    prompt: (input) => prompt(ask.mode === "flat" ? "plan-flat" : "plan", { ...input, date: today(), sources: sourcesFor(sources, ask.sources), coverage: covered }),
    parent: trunk ?? undefined,
    // How many tasks the plan may have. The planner's grammar enforces it, so the model cannot return more.
    maxTasks: BUDGETS.effort[ask.effort].maxTasks,
    availableAbilities: sources.length >= 2 ? sources : undefined,
  });
  return (yield* planner.execute({ query: ask.text })) as PlanResult;
}

/** How full the one shared context is, for the run's closing stats. `Ctx.expect()` asks for something ambient:
 *  the agent runtime was started once for the session, and anything running under it can ask for it like this
 *  instead of having it passed down. Called outside a session, it throws. */
function* contextUse(): Operation<Pick<Stats, "ctxPct" | "ctxPos" | "ctxTotal">> {
  const p = (yield* Ctx.expect())._storeKvPressure();
  const ctxTotal = p.nCtx || 1;
  return { ctxPct: Math.round((100 * p.cellsUsed) / ctxTotal), ctxPos: p.cellsUsed, ctxTotal };
}

/** From the trunk alone: a fork of it answers the question directly. The trunk is not written; the brief commits the pair. */
export function* answer(trunk: Branch, ask: Inputs, plan: PlanResult): Operation<Written> {
  const at = timer();
  const a = yield* useAgent({ parent: trunk, systemPrompt: render("answer.system"), content: ask.text, budget: BUDGETS.answer, acceptFreeText: true });
  const timeMs = at();
  return {
    answer: a.result?.trim() ? a.result : null,   // an answer with no text is no answer
    inquiries: [],
    stats: yield* contextUse(),
    complete: { intent: plan.intent, planTokens: plan.tokenCount, passthroughTokens: a.tokenCount, planMs: Math.round(plan.timeMs), passthroughMs: Math.round(timeMs) },
  };
}

/** How an investigation's next task is put to the spine, as the user turn the next inquiry attends. */
export const nextTask = (task: ResearchTask): string => `Research task: ${task.description}`;

/** How the inquiries run. A survey asks for them all at once — the pool seats what the context can hold and
 *  the rest wait their turn; an investigation runs them one after another, each reading what the last one
 *  added to the spine. This is the strategy, whole: hand `write` another to run the inquiries any way the
 *  framework offers (`fanout`, `dag`, an orchestrator of your own). */
export function inquire(ask: Inputs, tasks: readonly ResearchTask[], specFor: SpecFor): Orchestrator {
  return ask.mode === "flat"
    ? parallel(tasks.map((task, i) => specFor(task, i, true)))
    : chain([...tasks], (task: ResearchTask, i: number) => ({ task: specFor(task, i, false), userContent: nextTask(task) }));
}

/** The settling pass: one agent on the same spine folds the inquiries' findings into the answer. Findings the
 *  spine already holds are read from it; findings it does not hold are given in the prompt. Sends synthesize:*. */
export function* settle(spine: Branch, ask: Inputs, plan: PlanResult, evidence: Evidence): Operation<{ answer: string; tokens: number; timeMs: number; ppl?: number }> {
  const wire = yield* useWire<WorkflowEvent>();
  yield* wire.send({ type: "synthesize:start" });
  const at = timer();
  // Findings the spine holds are read from it; findings it does not are given in the prompt, one block per task.
  const told = evidence.attended
    ? prompt("synthesize", { query: ask.text })
    : prompt("synthesize-flat", { query: ask.text, findings: evidence.findings.map((body, i) => ({ task: plan.tasks[i]?.description ?? `task ${i + 1}`, body: body.trim() })) });
  const agent = yield* useAgent({ ...told, parent: spine, budget: BUDGETS.settle, acceptFreeText: true });
  const timeMs = at();
  const ppl = agent.branch.disposed ? 0 : agent.branch.perplexity;
  yield* wire.send({ type: "synthesize:done", agentId: agent.id, ppl, tokenCount: agent.tokenCount, toolCallCount: agent.toolCallCount, timeMs });
  return { answer: agent.result || "", tokens: agent.tokenCount, timeMs, ppl };
}

/** A strategy, run as it is, with a note kept of what it commits to the spine. Nothing else can say whether the
 *  settling agent already attends a finding: a strategy is free to commit every finding, some, or none. */
function watchingTheSpine(orchestrate: Orchestrator): { orchestrate: Orchestrator; committed: Map<string, number> } {
  const committed = new Map<string, number>();   // how many times each text was committed: two inquiries can say the same words
  const watched = (ctx: PoolContext): PoolContext => ({
    get spine() { return ctx.spine; },
    spawn: (spec) => ctx.spawn(spec),
    waitFor: (agent) => ctx.waitFor(agent),
    canFit: (tokens) => ctx.canFit(tokens),
    *extendSpine(userContent, assistantContent) {
      const grew = yield* ctx.extendSpine(userContent, assistantContent);
      if (grew > 0) committed.set(assistantContent, (committed.get(assistantContent) ?? 0) + 1);
      return grew;
    },
  });
  return { committed, orchestrate: (ctx) => orchestrate(watched(ctx)) };
}

/** Every inquiry under one shared spine, then the settling pass. The brief has already said the writing began;
 *  this says `research:done` when the inquiries are over, and the settling pass says synthesize:*. */
export function* write(trunk: Branch | null, ask: Inputs, plan: PlanResult, stages: Partial<Stages> = {}): Operation<Written> {
  const s: Stages = { answer, inquire, settle, output: citedReport, ...stages };
  if (plan.intent === "passthrough") {
    if (trunk) return yield* s.answer(trunk, ask, plan);
    plan = singleTaskPlan(ask.text);   // a cold trunk has nothing to answer from
  }
  if (plan.intent !== "research") throw new Error(`write: a ${plan.intent} plan cannot be written`);
  const wire = yield* useWire<WorkflowEvent>();
  const sources = yield* participating(ask.excluded, ask.sources);
  const primary = sources[0];
  const byProtocol = new Map(sources.map((a) => [a.manifest.protocol.name, a]));
  // A task's source is a routing hint, not a tool lock: it picks the preamble; every source's tools are on the
  // spine. A direct answer is scoped to no source: no preamble, the union of what is enabled, no persona.
  const sourceFor = (task: ResearchTask): Ability | undefined =>
    ask.direct ? undefined : (task.ability ? byProtocol.get(task.ability) : undefined) ?? primary;
  const tools = [...sources.flatMap((x) => [...x.tools]), s.output.tool];
  const tasks = plan.tasks;
  const writesTheAnswer = tasks.length === 1;   // one inquiry is its own answer: nothing settles it afterwards
  const date = today();
  const row = BUDGETS.effort[ask.effort];
  const tool = s.output.tool.name;
  const takesSources = "sources" in (s.output.tool.parameters.properties ?? {});   // the citation partial says how to fill them
  // What a reaped agent is told, above the row's floors: the framework hands the words it may still write.
  const recovery: PromptOf<{ budget: number }> = ({ budget }) => prompt("recovery", { tool, budget, writesTheAnswer });
  const budget: Budget = {
    ...row,
    nudge: NUDGE,
    recovery: { prompt: recovery, ...(ask.direct ? BUDGETS.direct : {}) },
    recoveryShape: ask.mode === "deep" ? "staggered" : row.recoveryShape,   // a chain recovers one stage at a time
  };
  const specFor: SpecFor = (task, i, beside) => {
    const source = sourceFor(task);
    const preamble = source
      ? renderAgentPreamble(source, {
          maxTurns: row.maxTurns, date,
          agentCount: beside ? tasks.length : 1,
          siblingTasks: beside ? tasks.filter((_, j) => j !== i).map((t) => t.description) : [],
          taskIndex: beside ? 0 : i,
        })
      : "";
    return {
      key: taskKey(i),
      content: taskToContent(task),
      systemPrompt: render("inquiry.system", { preamble, tool, takesSources: source ? takesSources : false, writesTheAnswer }),
      ...(source ? { assignedAbility: source.manifest.name } : {}),
      seed: 1000 + i,
    };
  };
  const at = timer();

  // The spine lives for exactly this callback: the inquiries fork from it, the settling pass reads what they
  // added to it, and it is released when the callback returns.
  return yield* withSpine<Written>(
    { parent: trunk ?? undefined, systemPrompt: renderSpine({ abilities: sources, reference: ask.sources }), tools },
    function* (spine) {
      const strategy = watchingTheSpine(s.inquire(ask, tasks, specFor));
      const pool = yield* agentPool({
        parent: spine, tools, terminal: s.output.tool, attachments: ask.sources,
        budget, guards: ask.guards, hooks: sources.length > 0 ? [EVIDENCE_FIRST] : [], acceptFreeText: ask.direct,
        scorer: primary?.source.createScorer(ask.text),
        orchestrate: strategy.orchestrate,
      });
      const researchMs = at();
      yield* wire.send({ type: "research:done", totalTokens: pool.totalTokens, totalToolCalls: pool.totalToolCalls, timeMs: researchMs });
      // One final outcome per inquiry, across heals, read through the output it was written with; a refused spawn reads empty.
      const found = tasks.map((_, i) => { const o = pool.byKey(taskKey(i)); return o ? (s.output.read(o) ?? "") : ""; });
      let text: string | null;
      let settled: { tokens: number; timeMs: number; ppl?: number } = { tokens: 0, timeMs: 0 };
      // An answer with no text is no answer, whichever path produced it: the view says so; nothing is invented.
      if (tasks.length === 1) text = found[0].trim() || null;  // one inquiry is its own answer
      else if (found.every((f) => !f.trim())) text = null;     // nothing to settle
      else {
        // Attended only if EVERY finding there is was committed — each one, not each distinct text: one that was
        // not would be lost to a prompt that supplies none, so anything short of all of them is handed over whole.
        const said = found.filter((f) => f.trim());
        const attended = said.every((f) => (strategy.committed.get(f) ?? 0) >= said.filter((g) => g === f).length);
        const r = yield* s.settle(spine, ask, plan, { findings: found, attended });
        text = r.answer.trim() ? r.answer : null; settled = r;
      }

      return {
        answer: text,
        inquiries: tasks.map((task, i) => ({ task: task.description, findings: found[i] })),
        stats: yield* contextUse(),
        complete: {
          intent: plan.intent, planTokens: plan.tokenCount, agentTokens: pool.totalTokens, synthTokens: settled.tokens,
          ...(settled.ppl !== undefined ? { synthPpl: settled.ppl } : {}),
          totalToolCalls: pool.totalToolCalls, agentCount: tasks.length,
          planMs: Math.round(plan.timeMs), researchMs: Math.round(researchMs), synthMs: Math.round(settled.timeMs),
        },
      };
    },
  );
}
