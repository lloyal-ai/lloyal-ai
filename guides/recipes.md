# Runtime recipes

[Back to the README](../README.md)

These examples expand the composition and agent patterns in the README. The generated templates
include further recipes in their own documentation.

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

The [services guide](https://docs.lloyal.ai/services) also describes how to extend this pattern to other
model types. Audio and classification require additional native service implementations; the composition
above uses the services available today.

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

A choice over a known list is a grammar, not a prompt. The reasoning model picks the pathway by NUMBER and
cannot answer anything else, so there is nothing to parse and no "the model said something else"; the judge
beside it ranks every letter against the pathway, so the ones to look at first are known. Both operations
run locally. The letter does not need to leave the application:

```ts
const pick = defineOutput("pathway", z.number().int().min(0).max(pathways.length));
const pool = yield* agentPool({
  systemPrompt: listing,            // the pathways, by number; read once, shared by every letter's agent
  schema: pick.schema,              // the answer IS a number in range
  enableThinking: false,
  acceptFreeText: true,
  orchestrate: parallel(letters.map((letter) => ({ systemPrompt: "", content: letter }))),
});
const pathway = pool.outcomes.map((o) => pick.read(o));
const judge = yield* service("reranker");
const rank = yield* call(() => judge.scoreBatch(pathways[0], letters));   // every letter against one pathway: an ORDER, one pass
```

Each letter gets an agent, scheduled in waves when the workload exceeds the available concurrency. The
list of pathways is read once and shared. The judge takes the letters in one batched service call per
pathway. Its score is the model's yes/no log-odds under the instruction, not a calibrated probability.
Use it to order results within a query; measure any score floor against your instruction and model.

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

Every `fetch_page` and every corpus search now returns the sections that answer *that* question, verbatim,
the best few within the query, and the canary pair refuses the boot if the sentence stops discriminating.
Measured on the shipped 0.6B judge: the rule in force on the date scores 7.2 against 2.1 for the one it
superseded, a gap of five where the default retrieval question gives three. (A lens that turns on negation, a
breach or a refutation, is beyond a 0.6B, which scored a complying clause as high as a breaching one; that is a
bigger judge, one block to swap.)

Then the focus narrows on its own. An agent reading a page scores its sections against what it just asked; as
the room fills, the policy flips to exploit and a section must also answer the brief's question. The default
flips at 40% of the room. Make the flip yours:

```ts
class Focused extends DefaultAgentPolicy {
  shouldExplore(agent: Agent, pressure: ContextPressure) {
    return agent.toolCallCount < 2;   // two reads on its own terms, then only what answers the brief
  }
}
```

Most of what looks like a new lens is a new reference string in the query, which costs nothing. A genuinely
different question is one instruction for the whole reranker, since the sentence is prefilled into its warm
trunk, and it takes effect at the next launch. [The focal lens](https://docs.lloyal.ai/focal-lens) is the whole
account.

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

An agent that tries to report before it has read two sources is refused once and told why; its second report
stands. The rule is one object handed to the pool of agents, and it is yours. The same five points in a tool
call's life let you refuse a call, rule that a result does not count, or end an agent early; the pool's bigger
judgements are one class you subclass for the single decision you care about.

```ts
const EVIDENCE_FIRST: ToolLifecycleHooks = {
  onReturn: ({ agent }) => agent.toolCallCount < 2 ? { type: "reject", message: "Use tools first." } : undefined,
};
class Patient extends DefaultAgentPolicy {
  shouldExit(agent: Agent, pressure: ContextPressure) {
    return pressure.critical && super.shouldExit(agent, pressure);   // room, never time; still one agent a tick
  }
}
yield* agentPool({ ...spec, hooks: [EVIDENCE_FIRST], policy: new Patient() });
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
