import type { Operation } from "effection";
import type { Branch } from "@lloyal-labs/sdk";
import type { Attachment } from "@lloyal-labs/media";
import { agent } from "@lloyal-labs/lloyal-agents";
import { defineOutput, abilityToc, type Ability } from "@lloyal-labs/rig";
import {
  Decision,
  decisionSchema,
  validateDecision,
  acceptedOutcome,
  type Mode,
} from "../domain/work.js";
import { samplingSeed } from "./sampling.js";
import { render } from "./prompts.js";
export function* decide(
  parent: Branch | null,
  question: string,
  mode: Mode,
  abilities: readonly Ability[],
  attachments: readonly Attachment[],
  context = "",
  inheritedQuestion = false,
  seed?: number,
): Operation<Decision> {
  seed ??= yield* samplingSeed();
  const output = defineOutput(
    "decision",
    decisionSchema(
      mode,
      abilities.map((a) => a.manifest.name),
      attachments.map((a) => a.digest),
    ),
  );
  const result = yield* agent({
    parent: parent ?? undefined,
    enableThinking: false,
    schema: output.schema,
    acceptFreeText: true,
    params: { temperature: 0.2, seed },
    budget: {
      maxTurns: 1,
      time: { softLimit: 45000, hardLimit: 90000 },
      recoveryBudget: 2048,
    },
    systemPrompt: render("decision.system"),
    content: render("decision.user", {
      question: inheritedQuestion ? null : question,
      mode,
      context,
      abilities: abilities.map((a) => ({
        name: a.manifest.name,
        useWhen: a.manifest.protocol.useWhen,
        contents: abilityToc(a, attachments),
      })),
      inputs: attachments.map((a) => a.digest),
    }),
  });
  if (!acceptedOutcome(result))
    throw new Error(
      `The decision did not complete: ${result.failed ?? result.exitReason ?? "no output"}.`,
    );
  const proposal = output.read(result);
  if (!proposal)
    throw new Error(
      "The proposed approach did not match its required format. Your request is saved; Continue can try again.",
    );
  return validateDecision(
    proposal,
    mode,
    abilities.map((a) => a.manifest.name),
    attachments.map((a) => a.digest),
  );
}
