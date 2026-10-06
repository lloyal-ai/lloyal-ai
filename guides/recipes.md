# Runtime recipes

[Back to the README](../README.md)

These examples expand the composition and agent patterns in the README. The generated templates
include further recipes in their own documentation.

## Hold and fork live attention handles

`session.trunk` and `agent.branch` are `Branch` objects: TypeScript handles to live attention state in the
resident model. The processed KV prefix is already there, along with each branch's sampler, grammar,
logits, and ancestry. At SDK level, a procedure that owns the model context can inspect an alternative
without changing its parent's attention:

```ts
import type { Branch } from "@lloyal-labs/sdk";

export async function probeEvidence(attention: Branch, tokens: number[]) {
  const probe = await attention.fork({ cloneLogits: false });
  try {
    await probe.prefill(tokens);
    return { entropy: probe.modelEntropy("bits"), logits: probe.getLogits() };
  } finally {
    await probe.prune();
  }
}
```

Here `tokens` is a non-empty, tokenized evidence delta. The fork shares the existing attention prefix;
prefill processes only the new material. The returned logits are a copy, so they remain available after
the temporary branch is pruned. Agent pools normally own these lifetimes and batch the branches for you;
use their lifecycle when a pool is running, rather than mutating its context concurrently.

The operations have distinct semantics:

| Operation | What happens to attention |
| --- | --- |
| Fork | Share the parent's KV prefix and clone the branch's sampling, grammar, and logit state. |
| Commit accepted text | Process the accepted text into the destination's attention. This is additional decode work, not a transfer of KV cells. |
| Promote a winner | `Session.promote()` retains the selected branch as the trunk and evicts the other branches in that context. |
| Replay onto a new base | Reprocess recorded content onto a new branch; the kernel's rebase analogy does not mean moving cache cells. |
| Blend distributions | `BranchStore.mergeLogits()` combines compatible branches' next-token distributions while their KV histories stay separate. |

[Continuous Context](https://docs.lloyal.ai/continuous-context) explains ownership and matched
continuations. The [kernel's Git comparison](https://github.com/lloyal-ai/liblloyal) distinguishes promotion,
hard merge, replay, and soft logit merging.

## Compose resident models

A reasoning model can work with resident specialists: an embedding model recalls candidates, a reranker
orders evidence, and a vision projector supplies image input. Tools coordinate those services during a
turn. The reranker and embedding model have their own contexts; the projector supplies input to the
reasoning model. Declare the models together:

```yaml
# harness.yml
model:
  llm:       { id: qwen3.5-4b }                 # reasons and writes
  reranker:  { id: qwen3-reranker-0.6b-q8 }     # the judge: which of these is relevant, in order
  embedding: { id: nomic-embed-text-v1.5-q4 }   # memory: which of ten thousand passages are near this question
  vision:    {}                                 # sight: the projector paired with the reasoning model
```

The [services guide](https://docs.lloyal.ai/services) describes the provider contract linking a model's
configuration, provisioning, and runtime binding.

Naming a block composes that model: it is fetched and verified before your program runs, and harness code
and its tools can access the bound service. For example, retrieve and rerank passages from a contract index:

```ts
const memory = yield* service("embedding");
const judge = yield* service("reranker");

const [q] = yield* memory.embed([question]);
const nearby = index.nearest(q, 50);                                   // your own index over memory.embed
const scores = yield* call(() => judge.scoreBatch(question, nearby.map((c) => c.text)));
const evidence = nearby.map((c, i) => ({ c, s: scores[i] })).sort((a, b) => b.s - a.s).slice(0, 10).map((x) => x.c);   // the ten the judge ranks highest
```

Hand `evidence` to the reasoning model and it explains; hand it to ten agents and each explains one clause;
attach the signed pages and sight reads the signatures. Remove a block and that model is gone; an installed
ability that needs it is refused by name at start, and your program still runs. A kind of model the platform
does not know yet is one row in its table: [services](https://docs.lloyal.ai/services).

## Typed decisions

An ordinary resident LLM can make a bounded decision, without a classifier fine-tune. A schema constrains
decoding to the decision's shape, and `read` returns the typed value or `null`. For casework, number the
pathways from 1 through N and reserve 0 for no match:

```ts
import { z } from "zod";
import { defineOutput } from "@lloyal-labs/rig";
import { agentPool, parallel } from "@lloyal-labs/lloyal-agents";

export function* routeLetters(pathways: string[], letters: string[]) {
  const options = pathways.map((name, i) => `${i + 1}. ${name}`).join("\n");
  const pick = defineOutput("pathway", z.number().int().min(0).max(pathways.length));
  const pool = yield* agentPool({
    systemPrompt: `Choose a pathway number. Use 0 when none applies.\n${options}`,
    schema: pick.schema,
    enableThinking: false,
    acceptFreeText: true,
    capacity: 8,
    pruneOnReturn: true,
    orchestrate: parallel(letters.map(content => ({ systemPrompt: "", content }))),
  });
  return pool.outcomes.map(outcome => pick.read(outcome));
}
```

Each letter gets an agent, scheduled in waves at the configured capacity. Completed branches release
their slots while their typed outcomes remain available. All inherit the attention state of one processed
option list. This is the Jev-style decision pattern: the application changes the choices
and the procedure, while the LLM's weights stay the same.

Classification and prioritization are separate operations. After choosing a pathway, a reranker can rank
the matching letters against it:

```ts
import { call } from "effection";
import { service } from "@lloyal-labs/rig";

export function* prioritize(pathway: string, matchingLetters: string[]) {
  const judge = yield* service("reranker");
  return yield* call(() => judge.scoreBatch(pathway, matchingLetters));
}
```

These scores order evidence within that query. They are the reranker's yes/no log-odds under its
instruction, not calibrated probabilities. A score floor needs measurement for that model and instruction.

For a procedure that first investigates and then returns a typed decision, use a terminal output:

```ts
import { z } from "zod";
import { defineOutput } from "@lloyal-labs/rig";
import { agentPool, parallel, type Tool } from "@lloyal-labs/lloyal-agents";

const verdict = defineOutput("verdict", z.object({
  decision: z.enum(["approve", "reject", "refer"]),
  reason: z.string(),
}));

export function* assessCase(content: string, tools: readonly Tool[]) {
  const pool = yield* agentPool({
    tools,
    terminal: verdict.tool,
    orchestrate: parallel([{
      systemPrompt: "Investigate the case, then submit a verdict with your reason.",
      content,
    }]),
  });
  return pool.outcomes.map(outcome => verdict.read(outcome));
}
```

The terminal ends the agent's turn and validates the result. A schema constrains the shape of a decision;
your prompts, evidence, tools, and acceptance rules determine the decision's quality. The wiki template's
[classifier](../templates/basic/src/harness/classify.ts) discovers categories with one agent, then files
articles under them with a pool. [Typed Decisions from LLMs](https://docs.lloyal.ai/typed-decisions) covers
both forms and custom capture functions.

## Address, project, and cite media

The duplex media plane uses one content-addressed manifest for ingress, inference, citation, and replay.
The store is an OCI Image Layout, with digest-named blobs and manifests describing their roles. The
content handle is an `Attachment`, a descriptor of that manifest; it is not the bytes of an image or PDF.

The scaffold already creates the project's store and upload routes. For standalone use, initialize a
store and ingress once in your host, then admit uploads through it:

```ts
import { materialize } from "@lloyal-labs/media";
import { FileAttachmentStore, createContentIngress } from "@lloyal-labs/media/node";

const store = new FileAttachmentStore("media");
const ingress = createContentIngress(store);

export async function admitMedia(bytes: Uint8Array) {
  const attachment = await ingress.ingest(bytes);
  return { attachment, bitmaps: materialize(store, [attachment]).bitmaps };
}
```

Image ingress needs `sharp`; PDF ingress needs `@embedpdf/pdfium`. The research scaffold includes both.
An image's manifest records its admitted representation, the retained source when applicable, and the
parameters used to derive it. A PDF also has extracted text and document metadata; its page and figure
representations have their own image roots. `materialize` resolves image roots to the stored pixels;
a document root yields no bitmaps because its text is available for retrieval.

An upload returns the descriptor to the client. A later command carries that descriptor back to the
harness, where `admitted` checks its shape, resolves it against the store, and checks vision availability
for anything that needs projection:

```ts
import type { Session } from "@lloyal-labs/sdk";
import type { Descriptor } from "@lloyal-labs/media";
import { admitted } from "@lloyal-labs/rig";
import { waitUntilSettled } from "@lloyal-labs/lloyal-agents";

export function* attach(session: Session, text: string, refs: Descriptor[]) {
  const media = yield* admitted(refs);
  if ("refused" in media) throw new Error(media.refused);

  yield* waitUntilSettled(session.prefillUserMultimodal(text, media.bitmaps, {
    attachments: media.projected,
  }));
  return media.roots;
}
```

The application can report a refusal through its command handler. On success, pass the roots as the next
pool's `attachments`, and fork from the session trunk. Images projected before the fork become inherited
attention. A page projected later into one agent belongs to that lineage and its future descendants.

The documents ability gives agents `search_documents`, `read_document`, and `view_page`. Results include
citations such as `attachment://<digest prefix>/page/3`; the view resolves those through the same manifest
graph. Tool-produced images also pass through ingress before the runtime admits them into attention.

That is the outward half of duplex: a user can open the evidence an agent cited, while a trace retains the
addresses needed to rebuild the run's inputs. Keep `media/` with the trace. Content addressing deduplicates
the bytes; it does not promise identical future generations under different model or runtime settings.

The layout's compatibility is exercised with `oras`: it reads artifacts written by the package, and the
package reads artifacts copied by `oras`. The format can use your existing OCI artifact infrastructure.
[Media package](https://github.com/lloyal-ai/hdk/tree/main/packages/media) ·
[Attachments and documents](https://docs.lloyal.ai/attachments).

## Govern context admission

Similarity hands you both: a superseded rule answers the question it was superseded on, and the two are
neighbours in any embedding. Here nothing enters the model's context by distance. A judge is asked a
question in English about every candidate, and the question is yours, in one place:

```yaml
# harness.yml: one sentence, and every ability that reads pages or a corpus admits by it
model:
  reranker:
    id: qwen3-reranker-0.6b-q8
    instruction:
      text: "Given a question about the rule in force on a date, judge whether the Document states the rule in force on that date."
      smokeTest:
        query: "What notice period applies to a rent increase in 2026?"
        matching: "From 1 January 2026 a landlord must give 90 days' notice of a rent increase."
        nonMatching: "Until 2020 a landlord was required to give 30 days' notice of a rent increase."
        minGap: 2
```

The web and corpus abilities now select sections using that instruction. The canary checks the matching
and non-matching examples at launch and refuses to continue if the score gap is too small. A useful lens
depends on the instruction and the model's ability to discriminate your cases; change the model block
when the task needs a stronger judge.

An agent exploring a page scores sections against its immediate question. In exploit mode, admission also
scores against the original brief. The default policy stops exploring at 40% context remaining, or its
configured time threshold. Override that decision with your own policy:

```ts
import { DefaultAgentPolicy, type Agent, type ContextPressure } from "@lloyal-labs/lloyal-agents";

class Focused extends DefaultAgentPolicy {
  shouldExplore(agent: Agent, pressure: ContextPressure) {
    return agent.toolCallCount < 2;   // two reads on its own terms, then only what answers the brief
  }
}
```

A tool's reference question can change with each score call. The reranker's instruction is a shared
prefilled prefix; changing it takes effect when the service starts again.
[The focal lens](https://docs.lloyal.ai/focal-lens) explains the distinction and how to measure the score gap.

## Change settings during a run

Change a source or lower a limit while the agents are working, and each agent reads the new setting at
its next applicable call. The run continues. A tool reads its ability's settings at the call; declare
your own setting once and read it the same way.

```ts
// src/config.ts: declared once; harness.yml can commit it, the settings pane saves it
"answer.words": { yml: "answer.words", integer: true, default: 400, describe: "How long an answer may run." },

// wherever it is used: read at the call, so a save applies at the next one
const words = config().answer.words;
```

## Apply agent policy

Give an agent an opportunity to do more work before reporting: this hook challenges its first return if
it has made fewer than two non-terminal tool calls. The runtime bounds that challenge so an agent can
still conclude. Your domain may require a more specific check of the evidence it attended to.

The pool also accepts a policy subclass. When providing a custom policy, put its hooks on the policy
itself; the pool's top-level `hooks` option belongs to the default policy it otherwise constructs:

```ts
import {
  agentPool, DefaultAgentPolicy,
  type Agent, type ContextPressure, type Orchestrator, type Tool, type ToolLifecycleHooks,
} from "@lloyal-labs/lloyal-agents";

const EVIDENCE_FIRST: ToolLifecycleHooks = {
  onReturn: ({ agent }) => agent.toolCallCount < 2 ? { type: "reject", message: "Use tools first." } : undefined,
};
class Patient extends DefaultAgentPolicy {
  shouldExit(agent: Agent, pressure: ContextPressure) {
    return pressure.critical && super.shouldExit(agent, pressure);   // room, never time; still one agent a tick
  }
}

export function* runPatientPool(orchestrate: Orchestrator, tools: readonly Tool[], terminal: Tool) {
  return yield* agentPool({
    orchestrate,
    tools,
    terminal,
    policy: new Patient({ hooks: [EVIDENCE_FIRST] }),
  });
}
```

## Write tools over application data

A tool is a class in your program over your own database, with a gate of its own. Add it to the pool's tools
and every agent can call it. Nothing about it exists outside your process.

```ts
const oncePerMrn: ToolGuard = { name: "record_once", reject: ({ args, attended }) => attended().some((a) => a.mrn === args.mrn), message: "Already read." };

export class RecordTool extends Tool<{ mrn: string }> {
  readonly name = "record";
  readonly description = "The patient's record, by medical record number.";
  readonly parameters: JsonSchema = { type: "object", properties: { mrn: { type: "string" } }, required: ["mrn"] };
  readonly hooks: ToolLifecycleHooks = { beforeDispatch: [oncePerMrn] };
  *execute(args: { mrn: string }): Operation<unknown> { return yield* call(() => records.get(args.mrn)); }
}
```
