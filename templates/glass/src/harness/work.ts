import { createQueue, race } from "effection";
import type { Operation } from "effection";
import type { Branch } from "@lloyal-labs/sdk";
import type { Attachment } from "@lloyal-labs/media";
import {
  agentPool,
  parallel,
  chain,
  fanout,
  dag,
  withSpine,
} from "@lloyal-labs/lloyal-agents";
import type {
  Orchestrator,
  PoolContext,
  SpawnSpec,
} from "@lloyal-labs/lloyal-agents";
import {
  participating,
  renderSpine,
  renderAgentPreamble,
  citedReport,
  coverage,
  useWire,
  type Ability,
} from "@lloyal-labs/rig";
import {
  acceptedOutcome,
  validatePlan,
  retainedFindings,
  type Mode,
  type Plan,
  type PlanState,
  type WorkTask,
  type Finding,
  type Decision,
} from "../domain/work.js";
import { answerText, type Answer } from "../domain/answer.js";
import type { WorkflowEvent } from "../protocol.js";
import { answer } from "./direct.js";
import { steer } from "./steering.js";
import { decide } from "./decisions.js";
import { answerOutput, finishAnswer } from "./outputs.js";
import { samplingSeed } from "./sampling.js";
import { BUDGETS } from "./budgets.js";
import { render, prompt } from "./prompts.js";

type Change = { type: "start" | "finish" } | { type: "revise"; plan: Plan };
export class WorkControl {
  checkpoint?: () => Operation<void>;
  resetScope?: (query: string, roots: Attachment[]) => Operation<Branch | null>;
  plan: Plan | null = null;
  revision = 0;
  awaitingApproval = false;
  changing = false;
  finishing = false;
  available: string[] = [];
  inputs: string[] = [];
  findings = new Map<string, Finding>();
  directionPending = false;
  finalQuery = "";
  sourceRestricted = false;
  finalExcluded: string[] = [];
  finalInputs: string[] = [];
  readonly directions = createQueue<{ query: string }, never>();
  requestDirection(query: string) {
    if (this.directionPending || this.changing || this.finishing)
      throw new Error(
        "Wait for the current change to settle before steering again.",
      );
    if (!query.trim()) throw new Error("Write a direction first.");
    this.directionPending = true;
    this.directions.add({ query: query.trim() });
  }
  *nextDirection(): Operation<{ query: string }> {
    const next = yield* this.directions.next();
    if (next.done) throw new Error("The work owner closed.");
    return next.value;
  }
  readonly changes = createQueue<Change, never>();
  constructor(readonly mode: Mode) {}
  state(problem?: string): PlanState | null {
    return this.plan
      ? {
          plan: this.plan,
          revision: this.revision,
          awaitingApproval: this.awaitingApproval,
          retained: [...this.findings.keys()].filter((id) =>
            this.plan!.tasks.some((t) => t.id === id),
          ),
          ...(problem ? { problem } : {}),
        }
      : null;
  }
  approve(revision: number) {
    this.check(revision);
    if (!this.awaitingApproval)
      throw new Error("This approach has already started.");
    this.awaitingApproval = false;
    this.changes.add({ type: "start" });
  }
  revise(input: unknown, revision: number) {
    this.check(revision);
    const plan = validatePlan(input, this.mode, this.available, this.inputs);
    this.changing = true;
    this.revision++;
    this.changes.add({ type: "revise", plan });
  }
  check(revision: number) {
    if (!this.plan || this.changing || revision !== this.revision)
      throw new Error(
        "The approach changed. Reopen its latest revision before editing.",
      );
  }
  finish() {
    if (this.finishing) return;
    this.finishing = true;
    this.awaitingApproval = false;
    this.changes.add({ type: "finish" });
  }
  *next(): Operation<Change> {
    const next = yield* this.changes.next();
    if (next.done) throw new Error("The work owner closed.");
    return next.value;
  }
}
class DependencyRejected extends Error {}
const outcomeOf = (a: {
  result: string | null;
  exitReason?: string;
  failed: string | null;
}) => a;

/** Add acceptance policy around the public factories. The pool still owns seating, execution and waits. */
export function guardedShape(
  plan: Plan,
  specFor: (t: WorkTask) => SpawnSpec,
  findings: Map<string, Finding>,
  notify: (id: string, accepted: boolean, reason?: string) => Operation<void>,
): Orchestrator {
  return function* (ctx) {
    const inherited = new Set<string>();
    for (const [id, f] of findings) {
      yield* ctx.extendSpine(render("finding", { ...f.task }), f.text);
      inherited.add(id);
    }
    const keys = new Map<number, string>(),
      lineage = new Map<number, string[]>();
    const labels = new Map(
      plan.tasks.map((t) => [render("finding", { ...t }), t.id]),
    );
    const guarded: PoolContext = {
      spine: ctx.spine,
      canFit: (n) => ctx.canFit(n),
      *spawn(spec) {
        const t = plan.tasks.find((t) => t.id === spec.key)!;
        if (t?.dependsOn.some((id) => !findings.has(id)))
          throw new DependencyRejected(
            `A prerequisite of “${t.title}” has no accepted finding.`,
          );
        const visible = [...inherited];
        const a = yield* ctx.spawn(spec);
        if (spec.key) keys.set(a.id, spec.key);
        lineage.set(a.id, visible);
        return a;
      },
      *waitFor(a) {
        const final = yield* ctx.waitFor(a),
          id = keys.get(a.id),
          task = plan.tasks.find((t) => t.id === id);
        if (task) {
          const accepted = acceptedOutcome(outcomeOf(final));
          if (accepted)
            findings.set(task.id, {
              task,
              text: final.result!,
              influencedBy: lineage.get(a.id) ?? [],
            });
          yield* notify(
            task.id,
            accepted,
            accepted
              ? undefined
              : (final.failed ?? final.exitReason ?? "No accepted result"),
          );
          if (!accepted && plan.topology !== "parallel")
            throw new DependencyRejected(
              `“${task.title}” ended without an accepted finding. Review its dependent work.`,
            );
        }
        return final;
      },
      *extendSpine(user, body) {
        const n = yield* ctx.extendSpine(user, body);
        const id = labels.get(user);
        if (id) inherited.add(id);
        return n;
      },
    };
    const pending = plan.tasks.filter((t) => !findings.has(t.id));
    let shape: Orchestrator;
    if (plan.topology === "parallel") shape = parallel(pending.map(specFor));
    else if (plan.topology === "chain")
      shape = chain(pending, (t) => ({
        task: specFor(t),
        userContent: render("finding", { ...t }),
      }));
    else if (plan.topology === "fanout" && !findings.has(plan.tasks[0].id))
      shape = fanout(
        {
          task: specFor(plan.tasks[0]),
          userContent: render("finding", { ...plan.tasks[0] }),
        },
        pending.slice(1).map(specFor),
      );
    else if (plan.topology === "fanout") shape = parallel(pending.map(specFor));
    else
      shape = dag(
        pending.map((t) => ({
          id: t.id,
          task: specFor(t),
          dependsOn: t.dependsOn.filter((id) => !findings.has(id)),
          userContent: render("finding", { ...t }),
        })),
      );
    yield* shape(guarded);
    // Parallel siblings do not merge KV. Put only accepted findings on the owned work spine.
    for (const [id, f] of findings)
      if (!inherited.has(id)) {
        yield* ctx.extendSpine(render("finding", { ...f.task }), f.text);
        inherited.add(id);
      }
  };
}

function* composeWork(
  trunk: Branch | null,
  question: string,
  attachments: Attachment[],
  excluded: string[],
  control: WorkControl,
  inheritedQuestion = false,
  resumed = false,
  kind: Answer["kind"] = "prose",
  conversationBoundary = "",
): Operation<Answer> {
  const seed = yield* samplingSeed();
  const wire = yield* useWire<WorkflowEvent>();
  let abilities = yield* participating(excluded, attachments);
  control.available = abilities.map((a) => a.manifest.name);
  control.inputs = attachments.map((a) => a.digest);
  if (control.mode === "Direct")
    return yield* answer(
      trunk,
      question,
      attachments,
      excluded,
      kind === "prose" ? undefined : kind,
      inheritedQuestion,
    );
  yield* wire.send({ type: "work:phase", phase: "deciding" });
  let decision =
    resumed && control.plan
      ? {
          action: "compose" as const,
          plan: control.plan,
          reason: control.plan.reason,
          presentation: control.plan.presentation,
          clarification: "",
          sourceScope: null,
        }
      : resumed
        ? {
            action: "answer" as const,
            plan: null,
            reason: "The request has been revised.",
            presentation: kind,
            clarification: "",
            sourceScope: null,
          }
        : yield* decide(
            trunk,
            question,
            control.mode,
            abilities,
            attachments,
            conversationBoundary,
            inheritedQuestion,
          );
  function* applyScope(
    scope: NonNullable<Decision["sourceScope"]>,
  ): Operation<boolean> {
    const restricted =
      abilities.some((a) => !scope.abilities.includes(a.manifest.name)) ||
      attachments.some((a) => !scope.inputs.includes(a.digest));
    excluded = [
      ...new Set([
        ...excluded,
        ...abilities
          .filter((a) => !scope.abilities.includes(a.manifest.name))
          .map((a) => a.manifest.name),
      ]),
    ];
    attachments = attachments.filter((a) => scope.inputs.includes(a.digest));
    abilities = abilities.filter((a) =>
      scope.abilities.includes(a.manifest.name),
    );
    control.available = abilities.map((a) => a.manifest.name);
    control.inputs = attachments.map((a) => a.digest);
    control.finalExcluded = excluded;
    control.finalInputs = control.inputs;
    if (restricted) {
      control.sourceRestricted = true;
      control.findings.clear();
      if (control.checkpoint) yield* control.checkpoint();
      yield* wire.send({
        type: "work:scope",
        inputs: control.inputs,
        excluded,
      });
      trunk = control.resetScope
        ? yield* control.resetScope(question, attachments)
        : null;
      inheritedQuestion = !!trunk;
    }
    return restricted;
  }
  if (decision.sourceScope) yield* applyScope(decision.sourceScope);
  yield* wire.send({ type: "work:decision", reason: decision.reason });
  if (decision.action === "clarify")
    return { kind: "prose", result: decision.clarification, sources: [] };
  if (decision.action === "answer") {
    yield* wire.send({ type: "work:phase", phase: "answering" });
    return yield* answer(
      trunk,
      question,
      attachments,
      excluded,
      decision.presentation,
      inheritedQuestion,
    );
  }
  control.plan = decision.plan!;
  if (!resumed) control.revision++;
  control.awaitingApproval =
    control.mode === "Plan" || control.mode === "Graph" || control.plan.review;
  const announce = function* (problem?: string): Operation<void> {
    if (control.checkpoint) yield* control.checkpoint();
    yield* wire.send({ type: "work:plan", state: control.state(problem)! });
  };
  let stages = 0,
    previousAnswer: Answer | null = null;
  for (;;) {
    yield* announce();
    if (control.awaitingApproval) {
      yield* wire.send({ type: "work:phase", phase: "review" });
      const change = yield* control.next();
      if (change.type === "revise") {
        control.findings = retainedFindings(
          control.plan!,
          change.plan,
          control.findings,
        );
        control.plan = change.plan;
        control.changing = false;
        continue;
      }
    }
    const plan = control.plan!,
      rev = control.revision;
    yield* wire.send({ type: "work:phase", phase: "working" });
    type Attempt =
      | { type: "answer"; value: Answer; next?: Plan; follow?: Decision }
      | { type: "blocked"; message: string };
    const attempt = function* (): Operation<Attempt> {
      return yield* withSpine(
        { parent: trunk ?? undefined },
        function* (spine) {
          if (
            plan.preflight &&
            !control.finishing &&
            control.findings.size === 0
          ) {
            yield* wire.send({ type: "work:phase", phase: "preflight" });
            const probed = yield* coverage({
              query: question,
              sources: abilities,
              parent: spine,
              reference: attachments,
              prompt: (input) => prompt("coverage", input),
              budget: {
                maxTurns: 3,
                time: { softLimit: 60000, hardLimit: 120000 },
              },
            });
            // Feed source coverage to workers as discovery context, not an accepted finding.
            const seeded = yield* agentPool({
              parent: spine,
              orchestrate: function* (ctx) {
                yield* ctx.extendSpine(
                  render("coverage-handoff"),
                  probed.coverage,
                );
              },
            });
            if (seeded.failure) throw seeded.failure;
            yield* wire.send({ type: "work:coverage", text: probed.coverage });
            yield* wire.send({ type: "work:phase", phase: "working" });
          }
          const tools = abilities.flatMap((a) => [...a.tools]);
          const specFor = (task: WorkTask): SpawnSpec => {
            const ability = abilities.find(
              (a) => a.manifest.name === task.ability,
            );
            return {
              key: task.id,
              seed: seed + plan.tasks.findIndex((t) => t.id === task.id),
              assignedAbility: task.ability || undefined,
              systemPrompt: render("worker.system", {
                catalog: renderSpine({ abilities, reference: attachments }),
              }),
              content: render("worker.user", {
                question: inheritedQuestion ? null : question,
                instruction: task.instruction,
                preamble: ability
                  ? renderAgentPreamble(ability, {
                      agentCount: plan.tasks.length,
                      maxTurns: BUDGETS.direct.maxTurns,
                      siblingTasks: plan.tasks.map((t) => t.instruction),
                    })
                  : "",
              }),
            };
          };
          const notify = function* (
            id: string,
            accepted: boolean,
            reason?: string,
          ): Operation<void> {
            yield* wire.send({
              type: "work:outcome",
              id,
              revision: rev,
              accepted,
              reason,
            });
          };
          if (!control.finishing) {
            const pool = yield* agentPool({
              parent: spine,
              tools,
              attachments,
              terminal: citedReport.tool,
              scorer: abilities[0]?.source.createScorer(question),
              budget: { ...BUDGETS.direct, nudge: (i) => render("nudge", i) },
              orchestrate: guardedShape(
                plan,
                specFor,
                control.findings,
                notify,
              ),
            });
            if (pool.failure) {
              if (pool.failure instanceof DependencyRejected)
                return { type: "blocked", message: pool.failure.message };
              throw pool.failure;
            }
            for (const task of plan.tasks)
              if (!control.findings.has(task.id))
                yield* notify(
                  task.id,
                  false,
                  pool.byKey(task.id)?.failed ??
                    pool.byKey(task.id)?.exitReason ??
                    "No accepted finding",
                );
            if (!control.findings.size)
              return {
                type: "blocked",
                message:
                  "No part returned an accepted finding. Revise the approach, finish with the available context, or stop.",
              };
          } else {
            // Finish skips unstarted work, retaining only already accepted findings.
            const seeded = yield* agentPool({
              parent: spine,
              orchestrate: function* (ctx) {
                for (const f of control.findings.values())
                  yield* ctx.extendSpine(
                    render("finding", { ...f.task }),
                    f.text,
                  );
              },
            });
            if (seeded.failure) throw seeded.failure;
          }
          yield* announce();
          yield* wire.send({ type: "work:phase", phase: "answering" });
          const output = answerOutput(plan.presentation),
            missing = plan.tasks
              .filter((t) => !control.findings.has(t.id))
              .map((t) => ({ id: t.id, title: t.title }));
          const written = yield* agentPool({
            parent: spine,
            terminal: output.tool,
            attachments,
            budget: { ...BUDGETS.direct, maxTurns: 1 },
            orchestrate: parallel([
              {
                key: "answer",
                seed,
                systemPrompt: render("direct.system"),
                content: render("synthesis.user", {
                  question: inheritedQuestion ? null : question,
                  kind: plan.presentation,
                  missing,
                }),
              },
            ]),
          });
          if (written.failure) throw written.failure;
          const o = written.byKey("answer");
          if (!acceptedOutcome(o))
            throw new Error(
              `The combined answer did not complete: ${o?.failed ?? o?.exitReason ?? "no output"}.`,
            );
          const payload = output.read(o!);
          if (!payload)
            throw new Error("The combined answer did not match its format.");
          const value = finishAnswer(plan.presentation, payload);
          if (plan.revisit && !control.finishing && stages < 2) {
            yield* wire.send({ type: "work:phase", phase: "deciding" });
            const follow = yield* decide(
              spine,
              question,
              control.mode === "Plan" ? "Auto" : control.mode,
              abilities,
              attachments,
              render("boundary", {
                answer: answerText(value),
                completed: [...control.findings.keys()],
                missing,
                stage: stages + 1,
              }),
              inheritedQuestion,
            );
            if (follow.sourceScope) return { type: "answer", value, follow };
            if (follow.action === "clarify")
              return {
                type: "answer",
                value: {
                  kind: "prose",
                  result: follow.clarification,
                  sources: [],
                },
              };
            if (follow.action === "compose")
              return { type: "answer", value, next: follow.plan! };
          }
          return { type: "answer", value };
        },
      );
    };
    const outcome = yield* race([
      attempt(),
      (function* (): Operation<{ type: "change"; change: Change }> {
        return { type: "change", change: yield* control.next() };
      })(),
    ]);
    // race closes the losing owned scope, including native settle barriers, before this boundary.
    if (outcome.type === "change") {
      if (outcome.change.type === "revise") {
        control.findings = retainedFindings(
          plan,
          outcome.change.plan,
          control.findings,
        );
        control.plan = outcome.change.plan;
        control.changing = false;
        control.awaitingApproval = true;
      }
      continue;
    }
    if (outcome.type === "blocked") {
      control.awaitingApproval = true;
      control.revision++;
      yield* announce(outcome.message);
      yield* wire.send({ type: "work:phase", phase: "review" });
      // The fixed public DAG cannot prune selected descendants in place. Retain accepted work,
      // ask for an explicit validated revision, and rebuild a clean work spine after settlement.
      const change = yield* control.next();
      if (change.type === "revise") {
        control.findings = retainedFindings(
          plan,
          change.plan,
          control.findings,
        );
        control.plan = change.plan;
        control.changing = false;
      }
      continue;
    }
    previousAnswer = outcome.value;
    stages++;
    if (outcome.follow) {
      // The attempt has settled. Rebuild restricted evidence only after its child scopes close.
      const changed = yield* applyScope(outcome.follow.sourceScope!);
      if (outcome.follow.action === "clarify")
        return {
          kind: "prose",
          result: outcome.follow.clarification,
          sources: [],
        };
      if (outcome.follow.action === "answer") {
        if (!changed) return previousAnswer;
        return yield* answer(
          trunk,
          question,
          attachments,
          excluded,
          outcome.follow.presentation,
          inheritedQuestion,
        );
      }
      control.findings = changed
        ? new Map()
        : new Map([
            [
              "prior_stage",
              {
                task: {
                  id: "prior_stage",
                  title: "Previous accepted stage",
                  instruction: "Previous accepted stage",
                  ability: "",
                  dependsOn: [],
                },
                text: answerText(previousAnswer),
                influencedBy: [],
              },
            ],
          ]);
      control.plan = outcome.follow.plan;
      control.revision++;
      control.awaitingApproval =
        control.mode === "Plan" ||
        control.mode === "Graph" ||
        control.plan.review;
      continue;
    }
    if (!outcome.next) return previousAnswer;
    // Subsequent composition begins from accepted output, never from automatically merged sibling KV.
    control.findings = new Map([
      [
        "prior_stage",
        {
          task: {
            id: "prior_stage",
            title: "Previous accepted stage",
            instruction: "Previous accepted stage",
            ability: "",
            dependsOn: [],
          },
          text: answerText(previousAnswer),
          influencedBy: [],
        },
      ],
    ]);
    control.plan = outcome.next;
    control.revision++;
    control.awaitingApproval =
      control.mode === "Plan" ||
      control.mode === "Graph" ||
      outcome.next.review;
  }
}

/** A semantic revision ends its owned attempt before a new decision or work spine starts. */
export function* compose(
  trunk: Branch | null,
  question: string,
  attachments: Attachment[],
  excluded: string[],
  control: WorkControl,
  inheritedQuestion = false,
  conversationBoundary = "",
): Operation<Answer> {
  const wire = yield* useWire<WorkflowEvent>();
  let parent = trunk,
    refs = attachments,
    off = excluded,
    resumed = false,
    kind: Answer["kind"] = "prose";
  const directions: { query: string }[] = [];
  for (;;) {
    control.finalQuery = render("directed", { question, directions });
    control.finalExcluded = off;
    control.finalInputs = refs.map((a) => a.digest);
    const result = yield* race([
      (function* (): Operation<{ type: "answer"; value: Answer }> {
        return {
          type: "answer",
          value: yield* composeWork(
            parent,
            control.finalQuery,
            refs,
            off,
            control,
            inheritedQuestion,
            resumed,
            kind,
            conversationBoundary,
          ),
        };
      })(),
      (function* (): Operation<{ type: "direction"; query: string }> {
        return { type: "direction", ...(yield* control.nextDirection()) };
      })(),
    ]);
    if (result.type === "answer") return result.value;
    off = control.finalExcluded;
    refs = attachments.filter((a) => control.finalInputs.includes(a.digest));
    if (control.sourceRestricted) parent = null;
    directions.push({ query: result.query });
    control.finalQuery = render("directed", { question, directions });
    yield* wire.send({ type: "work:phase", phase: "revising" });
    const currentAbilities = yield* participating(off, refs);
    // Interpret without inherited evidence so a request to withdraw it cannot be contaminated by that evidence.
    const d = yield* steer(
      null,
      render("directed", { question, directions }),
      control.mode,
      control.plan,
      currentAbilities,
      refs,
    );
    yield* wire.send({ type: "work:decision", reason: d.reason });
    const restricted =
      currentAbilities.some((a) => !d.abilities.includes(a.manifest.name)) ||
      refs.some((a) => !d.inputs.includes(a.digest));
    off = [
      ...new Set([
        ...off,
        ...currentAbilities
          .filter((a) => !d.abilities.includes(a.manifest.name))
          .map((a) => a.manifest.name),
      ]),
    ];
    refs = refs.filter((a) => d.inputs.includes(a.digest));
    if (restricted) {
      parent = null;
      inheritedQuestion = false;
      control.findings.clear();
      control.sourceRestricted = true;
    }
    control.finalExcluded = off;
    control.finalInputs = refs.map((a) => a.digest);
    if (control.checkpoint) yield* control.checkpoint();
    if (restricted)
      yield* wire.send({ type: "work:scope", inputs: d.inputs, excluded: off });
    if (restricted && control.resetScope)
      parent = yield* control.resetScope(control.finalQuery, refs);
    if (d.kind === "clarify") {
      control.directionPending = false;
      return { kind: "prose", result: d.clarification, sources: [] };
    }
    if (d.kind === "replan") {
      control.findings = control.plan
        ? retainedFindings(control.plan, d.plan!, control.findings, restricted)
        : new Map();
      control.plan = d.plan;
    } else if (control.plan)
      control.plan = {
        ...control.plan,
        presentation: d.presentation,
        inputs: d.inputs,
      };
    kind = d.presentation;
    control.revision++;
    control.directionPending = false;
    control.changing = false;
    // Every follow-up is explicit in the next worker instruction, even if the original image question is on the trunk.
    inheritedQuestion = false;
    resumed = true;
  }
}
