import { z } from "zod";
export const Mode = z.enum([
  "Auto",
  "Direct",
  "Plan",
  "Parallel",
  "Chain",
  "Graph",
]);
export type Mode = z.infer<typeof Mode>;
export const Presentation = z.enum(["prose", "table", "checklist"]);
export const WorkTask = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  title: z.string().min(1).max(100),
  instruction: z.string().min(1).max(3000),
  ability: z.string(),
  dependsOn: z.array(z.string()).max(8),
});
export type WorkTask = z.infer<typeof WorkTask>;
export const Plan = z.object({
  objective: z.string().min(1).max(300),
  reason: z.string().max(300),
  topology: z.enum(["parallel", "chain", "graph", "fanout"]),
  presentation: Presentation,
  tasks: z.array(WorkTask).min(1).max(8),
  review: z.boolean(),
  preflight: z.boolean(),
  revisit: z.boolean(),
  inputs: z.array(z.string()),
});
export type Plan = z.infer<typeof Plan>;
const decisionFields = {
  reason: z.string().max(240),
  presentation: Presentation,
  sourceScope: z
    .object({ abilities: z.array(z.string()), inputs: z.array(z.string()) })
    .nullable()
    .default(null),
};
// The generated grammar must express the action/payload relationship, too.
const answerDecision = z.object({
  ...decisionFields,
  action: z.literal("answer"),
  clarification: z.literal(""),
  plan: z.null(),
});
const clarifyDecision = z.object({
  ...decisionFields,
  action: z.literal("clarify"),
  clarification: z.string().min(1).max(500),
  plan: z.null(),
});
const composeDecision = z.object({
  ...decisionFields,
  action: z.literal("compose"),
  clarification: z.literal(""),
  plan: Plan,
});
export const Decision = z.discriminatedUnion("action", [
  answerDecision,
  clarifyDecision,
  composeDecision,
]);
export function decisionSchema(
  mode: Mode,
  abilities?: readonly string[],
  inputs?: readonly string[],
) {
  const choices = (values: readonly string[] | undefined) =>
    values === undefined
      ? z.array(z.string())
      : values.length
        ? z.array(z.enum([...values]))
        : z.array(z.string()).length(0);
  const fields = {
    sourceScope: z
      .object({ abilities: choices(abilities), inputs: choices(inputs) })
      .nullable()
      .default(null),
  };
  const answer = answerDecision.extend(fields),
    clarify = clarifyDecision.extend(fields);
  const topology = (
    { Parallel: "parallel", Chain: "chain", Graph: "graph" } as const
  )[mode as "Parallel" | "Chain" | "Graph"];
  const plan = Plan.extend({
    ...(abilities
      ? {
          tasks: z
            .array(WorkTask.extend({ ability: z.enum(["", ...abilities]) }))
            .min(1)
            .max(8),
        }
      : {}),
    inputs: choices(inputs),
    ...(topology ? { topology: z.literal(topology) } : {}),
    ...(["Plan", "Graph"].includes(mode) ? { review: z.literal(true) } : {}),
  });
  const compose = composeDecision.extend({ ...fields, plan });
  if (mode === "Auto")
    return z.discriminatedUnion("action", [answer, clarify, compose]);
  if (mode === "Direct")
    return z.discriminatedUnion("action", [answer, clarify]);
  return z.discriminatedUnion("action", [clarify, compose]);
}
export type Decision = z.infer<typeof Decision>;
export type Finding = { task: WorkTask; text: string; influencedBy: string[] };
export type PlanState = {
  plan: Plan;
  revision: number;
  awaitingApproval: boolean;
  retained: string[];
  problem?: string;
};
export function validatePlan(
  input: unknown,
  mode: Mode,
  abilities: readonly string[],
  inputs: readonly string[],
): Plan {
  if (input === null || input === undefined)
    throw new Error(
      "The decision proposed work without a plan. Your request is saved; Continue can try again.",
    );
  const p = Plan.parse(input),
    ids = new Set(p.tasks.map((t) => t.id));
  if (ids.size !== p.tasks.length)
    throw new Error("Each plan step needs a unique identity.");
  if (p.inputs.some((id) => !inputs.includes(id)))
    throw new Error("The plan refers to unavailable evidence.");
  for (const t of p.tasks) {
    if (t.ability && !abilities.includes(t.ability))
      throw new Error(
        `The ${t.ability} ability is not available for this request.`,
      );
    if (t.dependsOn.some((id) => !ids.has(id)))
      throw new Error(`A prerequisite of ${t.title} is missing.`);
    if (new Set(t.dependsOn).size !== t.dependsOn.length)
      throw new Error("A prerequisite is repeated.");
  }
  const visited = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("This plan has a dependency cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    p.tasks.find((t) => t.id === id)!.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  p.tasks.forEach((t) => visit(t.id));
  if (p.topology === "parallel" && p.tasks.some((t) => t.dependsOn.length))
    throw new Error(
      "Parallel steps must be independent. Use Graph for dependencies.",
    );
  if (
    p.topology === "chain" &&
    p.tasks.some((t, i) =>
      t.dependsOn.some((id) => !p.tasks.slice(0, i).some((x) => x.id === id)),
    )
  )
    throw new Error("A chain can depend only on earlier steps.");
  if (
    p.topology === "fanout" &&
    (p.tasks.length < 2 ||
      p.tasks[0].dependsOn.length ||
      p.tasks
        .slice(1)
        .some((t) => t.dependsOn.some((id) => id !== p.tasks[0].id)))
  )
    throw new Error(
      "A fanout needs one landscape followed by independent tasks.",
    );
  const forced = (
    { Parallel: "parallel", Chain: "chain", Graph: "graph" } as const
  )[mode as "Parallel" | "Chain" | "Graph"];
  if (forced && p.topology !== forced)
    throw new Error(`The proposed work does not honour ${mode} mode.`);
  if (mode === "Direct")
    throw new Error("Direct mode does not create a multi-agent plan.");
  if (mode === "Plan" && !p.review)
    throw new Error("Plan mode must wait for approval.");
  return p;
}
export function validateDecision(
  input: unknown,
  mode: Mode,
  abilities: readonly string[],
  inputs: readonly string[],
): Decision {
  const d = Decision.parse(input);
  if (
    d.sourceScope &&
    (d.sourceScope.abilities.some((a) => !abilities.includes(a)) ||
      d.sourceScope.inputs.some((a) => !inputs.includes(a)))
  )
    throw new Error("The decision requests unavailable sources.");
  if (d.action === "clarify") {
    if (!d.clarification.trim())
      throw new Error("A clarification must ask a question.");
    return d;
  }
  if (d.action === "answer") {
    if (!["Auto", "Direct"].includes(mode))
      throw new Error(`An answer alone would ignore ${mode} mode.`);
    if (d.plan)
      throw new Error("A direct answer cannot also carry a work plan.");
    return d;
  }
  return {
    ...d,
    plan: validatePlan(
      d.plan,
      mode,
      d.sourceScope?.abilities ?? abilities,
      d.sourceScope?.inputs ?? inputs,
    ),
  };
}
/** Withdraw descendants AND results that actually inherited the changed premise through the shared spine. */
export function retainedFindings(
  previous: Plan,
  next: Plan,
  findings: Map<string, Finding>,
  scopeChanged = false,
): Map<string, Finding> {
  if (scopeChanged) return new Map();
  const changed = new Set(
    previous.tasks
      .filter(
        (t) =>
          JSON.stringify(t) !==
          JSON.stringify(next.tasks.find((n) => n.id === t.id)),
      )
      .map((t) => t.id),
  );
  if (previous.topology === "chain") {
    const first = previous.tasks.findIndex(
      (t, i) => t.id !== next.tasks[i]?.id,
    );
    if (first >= 0)
      previous.tasks.slice(first).forEach((t) => changed.add(t.id));
  }
  if (JSON.stringify(previous.inputs) !== JSON.stringify(next.inputs))
    return new Map();
  if (previous.topology !== next.topology)
    previous.tasks.forEach((t) => changed.add(t.id));
  let size = -1;
  while (size !== changed.size) {
    size = changed.size;
    for (const t of next.tasks)
      if (t.dependsOn.some((d) => changed.has(d))) changed.add(t.id);
    for (const [id, f] of findings)
      if (f.influencedBy.some((d) => changed.has(d))) changed.add(id);
  }
  return new Map(
    [...findings].filter(
      ([id]) => !changed.has(id) && next.tasks.some((t) => t.id === id),
    ),
  );
}
export function acceptedOutcome(
  o:
    | { result: string | null; exitReason?: string; failed: string | null }
    | undefined,
): boolean {
  return !!o?.result?.trim() && !o.failed && !o.exitReason;
}
