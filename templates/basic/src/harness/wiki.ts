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

/** What an agent is told when it must wind its work up. The framework says why (`reason`) and how much room
 *  is left (`words`); the sentence is this app's. Without these words the framework drops the result or ends
 *  the turn instead of asking for what the agent already has. */
const NUDGE = ({ reason, words }: NudgeInput): string =>
  reason === "result" ? `Tool result too large for the remaining context. Report your findings now within ${words} words.`
  : reason === "time" ? `Time limit reached — report your findings now within ${words} words.`
  : reason === "turns" ? `Turn limit reached — report your findings now within ${words} words.`
  : `Context nearly full — report your findings now within ${words} words.`;

/** Said once to an angle that reports before it has read anything. Exported so the test asserts the words the
 *  model is actually told, rather than a copy of them that can drift. */
export const EVIDENCE_REJECTION = "Search or read a Wikipedia article before reporting.";

/**
 * An angle must have read something before it may report — an article built from notes nobody looked up is
 * the one failure this app cannot show honestly.
 *
 * This is a tool-lifecycle hook, and `onReturn` is the position for it: the terminal call ends the turn, and
 * a contributor here decides whether it may. The pool refuses a return once and nudges the model with this
 * message in the result's place; a second return stands, so an angle that genuinely found nothing can still
 * say so. `toolCallCount` is the evidence count — the terminal call itself is counted only after this
 * decision, so it cannot satisfy its own floor.
 */
const EVIDENCE_FIRST: ToolLifecycleHooks = {
  onReturn: ({ agent }) =>
    agent.toolCallCount < 1 ? { type: "reject", message: EVIDENCE_REJECTION } : undefined,
};

/**
 * The one place this app subclasses a policy. A pool consults ONE policy per role, and the settling agent
 * has no tools — its prose IS the result — so the decision that matters is what happens on a turn that makes
 * no tool call. This overrides that single hook and nothing else; every other decision stays the default's.
 */
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
  // The angles' row. The settling agent takes no budget: it has a policy of its own, and a nudge saying
  // "report your findings now" is advice only an agent with a terminal tool can act on.
  const budget: Budget = { maxTurns: MAX_TURNS, nudge: NUDGE };

  // The spine lives for exactly this callback: the angles fork from it, and it is released when the callback
  // returns. Per-token epistemics on a dev boot, and a returned agent's branch freed at once, are
  // `PoolDefaults` — set once by `initializeHarness`, so a pool never restates them.
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
      // One final outcome per angle, across heals, read through the output it was written with. Keyed, because
      // `pool.agents` order is the order they finished, and a refused or healed spawn would shift every note
      // onto the wrong angle.
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
