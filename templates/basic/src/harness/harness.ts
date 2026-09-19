/**
 * Your program — the one file that's genuinely yours.
 *
 * `basic` is deliberately the floor: two agents research a query in parallel
 * over a shared spine, a synth agent combines their notes. That's the whole
 * grammar in miniature — topology (`parallel`), a shared spine (`withSpine`), a
 * terminal tool (`report`), a reduce step (the synth). Replace it with your own
 * program; nothing else in the project needs to know what you wrote here.
 *
 * What is NOT here is the boot: the agent runtime, the ability registry, the
 * pool's defaults and the lifecycle signals are `initializeHarness`'s, called
 * once in `app.ts`. This file is handed a live `Session` and writes to the wire.
 */
import { call } from "effection";
import type { Channel, Operation } from "effection";
import type { Session } from "@lloyal-labs/sdk";
import {
  agentPool,
  useAgent,
  parallel,
  withSpine,
  renderTemplate,
  DefaultAgentPolicy,
  AbilityRegistryCtx,
} from "@lloyal-labs/lloyal-agents";
import type { Ability, AgentRenderCtx } from "@lloyal-labs/lloyal-agents";
import { citedReport, renderSpine, renderAgentPreamble } from "@lloyal-labs/rig";
import { reportBody } from "../ui/state.js";
import type { WorkflowEvent } from "./protocol.js";

const MAX_TURNS = 8;

/** The whole "plan": two fixed research angles. A real harness would *compute*
 *  these (an LLM planner, a routing rule, a workflow); basic keeps them static
 *  so the file reads top-to-bottom. Grow this into whatever your domain needs. */
const ANGLES = [
  "Gather the core facts, dates, and definitions.",
  "Gather context, significance, and differing viewpoints.",
];

// The synth prompt is where "note-dump" becomes "report". These few lines are a
// trimmed distillation of the RACE/DRB-tuned report discipline: commit to a
// thesis, structure by argument, ground every claim, cite inline. `research`
// ships the full benchmark-tuned versions as editable `.eta` files; basic keeps
// it inline (plain-`tsc` build) — edit it to shape how your intelligence writes.
const SYNTH_SYSTEM = [
  "You are a research synthesist. You are given several numbered research notes and",
  "must write ONE grounded markdown report that answers the question. Rules:",
  "",
  "- Open with a single-sentence **thesis** that directly answers the question — not a",
  "  restatement of the question, not a list of findings.",
  "- Structure the body into `##` sections named by their role in the argument (e.g.",
  '  "## What the sources establish", "## Where they disagree", "## What follows") —',
  "  never by note number or by source.",
  "- Write fluent prose. Use a bulleted list only for genuinely parallel items.",
  "- Ground every claim in the notes. Cite inline as [short title](url) using the exact",
  "  URLs that appear in the notes, placed right at the claim each supports.",
  "- Never invent a source, URL, or fact the notes don't contain. If the notes are thin,",
  "  say so in a sentence rather than padding.",
  "- End with a short `## Bottom line`. Do NOT append a Sources list — the interface",
  "  shows the sources separately.",
  "",
  "Output the markdown report directly — no preamble, no tool call.",
].join("\n");
const SYNTH_USER = [
  "Question: <%= it.query %>",
  "",
  "Research notes (cite by the URLs inside them):",
  "<%= it.notes %>",
  "",
  "Write the grounded markdown report.",
].join("\n");

// The follow-up variants. A second question DEEPENS the same article rather than
// starting a new one — each turn is another pass over one accreting page.
//
// Nothing re-sends the article: synth forks `session.trunk`, and `commitTurn`
// put the previous turn there, so the current article is already in this agent's
// KV prefix. These prompts only point at it. Re-injecting it as text would pay
// for the same tokens twice and grow with every turn.
const SYNTH_EXTEND_SYSTEM = [
  "You are extending an existing research article. The current article is above this",
  "message — it is the assistant side of the previous exchange. New research notes",
  "for a follow-up question are below. Rules:",
  "",
  "- Output the COMPLETE updated article, not a diff and not just the new part.",
  "- Preserve the existing sections and their inline citations. Change a claim only",
  "  where the new notes actually correct it.",
  "- Fold the new material into the section where it belongs. Add a new `##` section",
  "  only for genuinely new ground the article does not yet cover.",
  "- The result is ONE article about the whole subject, not two reports stitched",
  "  together. A reader arriving fresh should not be able to tell where one turn",
  "  ended and the next began.",
  "- Keep the opening thesis accurate for the article as it now stands, and update",
  "  `## Bottom line` to cover the whole page rather than only the latest question.",
  "- Same grounding rules as before: cite inline as [short title](url) using exact",
  "  URLs from the notes, and never invent a source, URL, or fact.",
  "",
  "Output the markdown article directly — no preamble, no tool call.",
].join("\n");
const SYNTH_EXTEND_USER = [
  "Follow-up question: <%= it.query %>",
  "",
  "New research notes (cite by the URLs inside them):",
  "<%= it.notes %>",
  "",
  "Extend the article above to cover this as well, and output the complete article.",
].join("\n");

/** Synthesis has two modes: open a page, or deepen the one already written. */
const SYNTH = {
  fresh: { system: SYNTH_SYSTEM, user: SYNTH_USER },
  deepen: { system: SYNTH_EXTEND_SYSTEM, user: SYNTH_EXTEND_USER },
} as const;

/**
 * The one place basic subclasses `AgentPolicy`. A pool consults ONE policy per
 * role; the synth agent has no tools, so its free text IS the result — but the
 * default policy gates a free-text return behind ≥1 tool call. This overrides
 * that single hook. (Every other decision uses the stock `DefaultAgentPolicy`.)
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

/** Per-agent system prompt — renders the ability's `skill.eta` with the render ctx. */
function agentPreamble(ability: Ability, taskIndex: number): string {
  return renderAgentPreamble(ability, {
    maxTurns: MAX_TURNS,
    agentCount: ANGLES.length,
    siblingTasks: [],
    date: new Date().toISOString().slice(0, 10),
    taskIndex,
  } as AgentRenderCtx & Record<string, unknown>);
}

export function* runQuery(
  query: string,
  session: Session,
  _wire: Channel<WorkflowEvent, void>,
): Operation<string> {
  const registry = yield* AbilityRegistryCtx.expect();
  const abilities = registry.enabled();
  if (abilities.length === 0) {
    throw new Error(
      "No Ability is enabled — add one to `abilities` in app.ts (e.g. `createWikipediaAbility`).",
    );
  }
  // Read BEFORE the turn is committed: a trunk here means an article already
  // exists, so this run deepens it instead of opening a new one.
  const mode = session.trunk ? "deepen" : "fresh";
  // The terminal: `report`, with its `sources` forced by the grammar and woven into the findings at capture, so
  // every note carries its citations inline and a `Sources:` list — the synth cites what is there, not what it finds.
  const tools = [...abilities.flatMap((a) => [...a.tools]), citedReport.tool];
  const spinePrompt = renderSpine({ abilities });

  // Two agents, in parallel, over one shared spine. `report` is the terminal
  // tool. Per-token epistemics on a dev boot, and a returned agent's branch
  // freed at once, are `PoolDefaults` — set once by `initializeHarness`, so a
  // pool never restates them.
  const notes = yield* withSpine<string[]>(
    { parent: session.trunk ?? undefined, systemPrompt: spinePrompt, tools },
    function* (spine) {
      const pool = yield* agentPool({
        tools,
        parent: spine,
        terminal: citedReport.tool,
        maxTurns: MAX_TURNS,
        policy: new DefaultAgentPolicy({ terminalToolName: citedReport.tool.name }),
        // Breadth: independent angles, in parallel, over one shared spine.
        // For sequential DEPTH — each task building on the last via the spine —
        // swap `parallel` for `chain(ANGLES, (angle, i) => ({ task: {...},
        // userContent: `…` }))` (import `chain` from `@lloyal-labs/lloyal-agents`).
        // The benchmark-tuned deep/flat research pipelines live in `research`.
        orchestrate: parallel(
          ANGLES.map((angle, i) => ({
            content: `${query}\n\nFocus: ${angle}`,
            systemPrompt: agentPreamble(abilities[0], i),
            seed: 1000 + i,
          })),
        ),
      });
      return pool.agents
        .map((a) => a.result?.trim() ?? "")
        .filter((r): r is string => r.length > 0);
    },
  );

  if (notes.length === 0) {
    return "No findings — the research agents returned nothing.";
  }

  // Synth: one agent, no tools, combines the notes. It forks the trunk, which
  // already holds the article, so `deepen` can point at it rather than restate
  // it — the page grows turn by turn instead of being replaced by a new one.
  const synth = yield* useAgent({
    systemPrompt: SYNTH[mode].system,
    task: renderTemplate(SYNTH[mode].user, {
      query,
      notes: notes.map((n, i) => `[${i + 1}] ${n}`).join("\n\n"),
    }),
    parent: session.trunk ?? undefined,
    policy: new SynthPolicy(),
    maxTurns: MAX_TURNS,
  });

  // `reportBody` drops the model's `<think>` reasoning and any stray markup, so the
  // committed turn + the `answer` event carry the clean markdown report — not the
  // raw stream. (The live agent cards keep `<think>` via `cleanNarration`; the final
  // answer does not.)
  const answer = reportBody(synth.result ?? "") || notes.join("\n\n");

  // The page IS the state, so re-base the trunk on the article as it now stands
  // rather than appending another copy beside the drafts it supersedes. With no
  // trunk, `commitTurn` takes its cold path — fresh branch, prefill, promote —
  // and promote's `retainOnly` reclaims the old one. Append instead and the
  // trunk ends up holding every revision of the page.
  //
  // Restore on failure: until `promote` lands there is no new trunk, so leaving
  // it null would silently drop the article and open the NEXT question on a
  // blank page. Better to lose the turn than the page.
  const superseded = session.trunk;
  session.trunk = null;
  try {
    yield* call(() => session.commitTurn(query, answer));
  } catch (err) {
    session.trunk = superseded;
    throw err;
  }
  return answer;
}
