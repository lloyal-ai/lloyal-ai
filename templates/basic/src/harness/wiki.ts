/**
 * Your program — what the model does. Takes the trunk and a question, RETURNS an article; never writes the
 * trunk, which is `article.ts`'s alone.
 *
 * `basic` is deliberately the floor: two agents read Wikipedia in parallel over a shared spine, then one
 * settling agent folds their notes into the article. That is the whole grammar in miniature — a topology
 * (`parallel`), a shared spine (`withSpine`), a terminal tool (`report`), and a reduce step. Replace it with
 * your own; nothing else in the project needs to know what you wrote here.
 */
import type { Operation } from "effection";
import type { Branch, Session } from "@lloyal-labs/sdk";
import {
  agentPool,
  useAgent,
  parallel,
  withSpine,
  DefaultAgentPolicy,
  AbilityRegistryCtx,
} from "@lloyal-labs/lloyal-agents";
import type {
  Ability,
  AgentRenderCtx,
  Budget,
  NudgeInput,
  ToolLifecycleHooks,
} from "@lloyal-labs/lloyal-agents";
import { citedReport, renderSpine, renderAgentPreamble, taskKey } from "@lloyal-labs/rig";
import { prompt } from "./prompts.js";

const MAX_TURNS = 8;

/** The whole "plan": two fixed angles. A real harness would *compute* these (an LLM planner, a routing rule,
 *  a workflow); basic keeps them static so the file reads top to bottom. Grow this into your domain. */
const ANGLES = [
  "Gather the core facts, dates, and definitions.",
  "Gather context, significance, and differing viewpoints.",
];

/** What an agent is told when it must wind up. The framework supplies `reason` and `words`; the sentence is
 *  this app's, and without one the framework drops the result rather than asking for it. */
const NUDGE = ({ reason, words }: NudgeInput): string =>
  reason === "result" ? `Tool result too large for the remaining context. Report your findings now within ${words} words.`
  : reason === "time" ? `Time limit reached — report your findings now within ${words} words.`
  : reason === "turns" ? `Turn limit reached — report your findings now within ${words} words.`
  : `Context nearly full — report your findings now within ${words} words.`;

/** Said once to an angle that reports before reading anything. Exported so the test asserts the real words. */
export const EVIDENCE_REJECTION = "Search or read a Wikipedia article before reporting.";

/**
 * An angle must have read something before it may report. `onReturn` is the position for it: the terminal
 * call ends the turn, and a hook here decides whether it may.
 *
 * The pool refuses once and nudges with this message; a second return stands, so an angle that genuinely
 * found nothing can still say so. `toolCallCount` excludes the terminal call at this point, so it cannot
 * satisfy its own floor.
 */
const EVIDENCE_FIRST: ToolLifecycleHooks = {
  onReturn: ({ agent }) =>
    agent.toolCallCount < 1 ? { type: "reject", message: EVIDENCE_REJECTION } : undefined,
};

/** The settling agent has no tools — its prose IS the result — so the only decision that matters is what
 *  happens on a turn with no tool call. This overrides that hook and nothing else. */
class SynthPolicy extends DefaultAgentPolicy {
  override onProduced(
    ...args: Parameters<DefaultAgentPolicy["onProduced"]>
  ): ReturnType<DefaultAgentPolicy["onProduced"]> {
    const [, parsed] = args;
    if (!parsed.toolCalls[0] && parsed.content) {
      return { type: "free_text_return", content: parsed.content };
    }
    return super.onProduced(...args);
  }
}

/** Per-agent system prompt — renders the ability's own `skill.eta` with the render context. */
function agentPreamble(ability: Ability, taskIndex: number): string {
  return renderAgentPreamble(ability, {
    maxTurns: MAX_TURNS,
    agentCount: ANGLES.length,
    siblingTasks: [],
    date: new Date().toISOString().slice(0, 10),
    taskIndex,
  } as AgentRenderCtx & Record<string, unknown>);
}

/** The article, or null when the angles found nothing worth settling — nothing is invented, and
 *  `article.ts` keeps nothing. */
export function* write(trunk: Branch | null, query: string): Operation<string | null> {
  const registry = yield* AbilityRegistryCtx.expect();
  const abilities = registry.enabled();
  if (abilities.length === 0) {
    throw new Error(
      "No Ability is enabled — add one to `abilities` in app.ts (e.g. `createWikipediaAbility`).",
    );
  }
  // The terminal: `report`, with its `sources` forced by the grammar and woven into the findings at capture,
  // so every note carries its citations inline and the settling agent cites what is there, not what it finds.
  const tools = [...abilities.flatMap((a) => [...a.tools]), citedReport.tool];
  // The angles' row. The settling agent takes none: a nudge to report is advice only an agent with a
  // terminal tool can act on.
  const budget: Budget = { maxTurns: MAX_TURNS, nudge: NUDGE };

  // The spine lives for exactly this callback: the angles fork from it, and it is released on return.
  return yield* withSpine<string | null>(
    { parent: trunk ?? undefined, systemPrompt: renderSpine({ abilities }), tools },
    function* (spine) {
      const pool = yield* agentPool({
        tools,
        parent: spine,
        terminal: citedReport.tool,
        budget,
        hooks: [EVIDENCE_FIRST],
        // Breadth: independent angles, in parallel, over one shared spine. For sequential DEPTH — each angle
        // building on the last via the spine — swap `parallel` for `chain` (from `@lloyal-labs/lloyal-agents`).
        orchestrate: parallel(
          ANGLES.map((angle, i) => ({
            key: taskKey(i),
            content: `${query}\n\nFocus: ${angle}`,
            systemPrompt: agentPreamble(abilities[0], i),
            seed: 1000 + i,
          })),
        ),
      });
      // Keyed, not positional: `pool.agents` is finish order, so a healed spawn would shift notes onto the
      // wrong angle.
      const found = ANGLES.map((_, i) => {
        const o = pool.byKey(taskKey(i));
        return o ? citedReport.read(o) ?? "" : "";
      });

      const notes = found.filter((f) => f.trim());
      if (notes.length === 0) return null;

      // A fork of the spine, which is itself a fork of the trunk: the article a follow-up extends is still in
      // view, and unlike a cold trunk there is always a prefix to write from.
      const settled = yield* useAgent({
        ...prompt(trunk ? "synthesize-extend" : "synthesize", {
          query,
          notes: notes.map((n, i) => `[${i + 1}] ${n}`).join("\n\n"),
        }),
        parent: spine,
        policy: new SynthPolicy(),
        maxTurns: MAX_TURNS,
      });
      return settled.result?.trim() ? settled.result : null;
    },
  );
}
