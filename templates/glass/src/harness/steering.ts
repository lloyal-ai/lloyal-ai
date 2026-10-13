import { z } from "zod";
import type { Operation } from "effection";
import type { Branch } from "@lloyal-labs/sdk";
import type { Attachment } from "@lloyal-labs/media";
import { agent } from "@lloyal-labs/lloyal-agents";
import { defineOutput, abilityToc, type Ability } from "@lloyal-labs/rig";
import {
  Plan,
  Presentation,
  acceptedOutcome,
  validatePlan,
  type Mode,
} from "../domain/work.js";
import { samplingSeed } from "./sampling.js";
import { render } from "./prompts.js";

export const Direction = z.object({
  kind: z.enum(["presentation", "replan", "clarify"]),
  reason: z.string().max(240),
  presentation: Presentation,
  plan: Plan.nullable(),
  clarification: z.string(),
  abilities: z.array(z.string()),
  inputs: z.array(z.string()),
});
export type Direction = z.infer<typeof Direction>;
export function validateDirection(
  value: unknown,
  mode: Mode,
  current: Plan | null,
  abilities: string[],
  inputs: string[],
): Direction {
  const d = Direction.parse(value);
  if (
    d.abilities.some((a) => !abilities.includes(a)) ||
    d.inputs.some((a) => !inputs.includes(a))
  )
    throw new Error(
      "The revision requests unavailable sources. Enable or attach them before starting new work.",
    );
  if (d.kind === "clarify" && !d.clarification.trim())
    throw new Error("The revision needs a clarification question.");
  if (
    d.kind === "presentation" &&
    current &&
    d.plan &&
    JSON.stringify(d.plan.tasks) !== JSON.stringify(current.tasks)
  )
    throw new Error("A presentation change cannot silently change the work.");
  if (d.kind === "presentation" && current)
    validatePlan(
      { ...current, presentation: d.presentation, inputs: d.inputs },
      mode,
      d.abilities,
      d.inputs,
    );
  if (d.kind === "replan")
    d.plan = validatePlan(d.plan, mode, d.abilities, d.inputs);
  return d;
}
export function* steer(
  parent: Branch | null,
  query: string,
  mode: Mode,
  current: Plan | null,
  abilities: readonly Ability[],
  attachments: readonly Attachment[],
): Operation<Direction> {
  const seed = yield* samplingSeed();
  const output = defineOutput("direction", Direction);
  const outcome = yield* agent({
    parent: parent ?? undefined,
    schema: output.schema,
    enableThinking: false,
    acceptFreeText: true,
    params: { temperature: 0.2, seed },
    budget: { maxTurns: 1, time: { softLimit: 45000, hardLimit: 90000 } },
    systemPrompt: render("direction.system"),
    content: render("direction.user", {
      query,
      mode,
      plan: current,
      abilities: abilities.map((a) => ({
        name: a.manifest.name,
        contents: abilityToc(a, attachments),
      })),
      inputs: attachments.map((a) => a.digest),
    }),
  });
  if (!acceptedOutcome(outcome))
    throw new Error(
      "The direction could not be resolved. Your message is saved; no revised work was started.",
    );
  return validateDirection(
    output.read(outcome),
    mode,
    current,
    abilities.map((a) => a.manifest.name),
    attachments.map((a) => a.digest),
  );
}
