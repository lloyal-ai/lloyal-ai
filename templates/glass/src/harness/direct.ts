import type { Attachment } from "@lloyal-labs/media";
import type { Operation } from "effection";
import type { Branch } from "@lloyal-labs/sdk";
import { agentPool, parallel, withSpine } from "@lloyal-labs/lloyal-agents";
import { participating, renderSpine } from "@lloyal-labs/rig";
import { acceptedOutcome } from "../domain/work.js";
import type { Answer } from "../domain/answer.js";
import { answerOutput, flexibleAnswerOutput, finishAnswer } from "./outputs.js";
import { samplingSeed } from "./sampling.js";
import { BUDGETS } from "./budgets.js";
import { render } from "./prompts.js";
export function* answer(
  trunk: Branch | null,
  question: string,
  attachments: Attachment[] = [],
  excluded: string[] = [],
  kind: Answer["kind"] | undefined = undefined,
  inheritedQuestion = false,
): Operation<Answer> {
  const seed = yield* samplingSeed();
  const abilities = yield* participating(excluded, attachments),
    output = kind ? answerOutput(kind) : flexibleAnswerOutput();
  const tools = [...abilities.flatMap((a) => [...a.tools]), output.tool];
  return yield* withSpine(
    {
      parent: trunk ?? undefined,
      systemPrompt: renderSpine({ abilities, reference: attachments }),
      tools,
    },
    function* (spine) {
      const pool = yield* agentPool({
        parent: spine,
        tools,
        attachments,
        scorer: abilities[0]?.source.createScorer(question),
        terminal: output.tool,
        budget: { ...BUDGETS.direct, nudge: (input) => render("nudge", input) },
        acceptFreeText: attachments.length === 0 && (!kind || kind === "prose"),
        orchestrate: parallel([
          {
            key: "answer",
            seed,
            content: render("answer.user", {
              question: inheritedQuestion ? null : question,
              kind: kind ?? "auto",
            }),
            systemPrompt: render("direct.system"),
          },
        ]),
      });
      if (pool.failure) throw pool.failure;
      const outcome = pool.byKey("answer");
      if (!acceptedOutcome(outcome))
        throw new Error(
          `The answer did not complete: ${outcome?.failed ?? outcome?.exitReason ?? "no output"}.`,
        );
      const structured = output.read(outcome!);
      // A normal free-text completion is valid prose; structured modes require their actual payload.
      if (
        !structured &&
        (!kind || kind === "prose") &&
        pool.agents.find((a) => a.agentId === outcome!.agentId)?.agent
          .resultSource === "free_text"
      )
        return { kind: "prose", result: outcome!.result!, sources: [] };
      if (!structured)
        throw new Error("The answer did not match the requested format.");
      return finishAnswer(
        kind ??
          ("kind" in structured
            ? (structured.kind as Answer["kind"])
            : "prose"),
        structured,
      );
    },
  );
}
