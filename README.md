# lloyal

**What becomes possible when the model and the program live in the same process?**

Most AI code is a client: it sends a request to a model somewhere and waits. Lloyal puts the model *inside* the
application, so your code has control *through* inference, not only around it. It can fork the model's live
attention into several agents at once, hand each different evidence, decide what the next stage inherits, and
commit only what it accepts. Every one of those decisions is ordinary TypeScript, and it runs on hardware you
own — a laptop today, your own GPU host when you serve it. No API key on the path that thinks.

Think of a game engine. You program the behaviour; Lloyal handles the physics underneath.

![An app generated from the deep-research template, writing a brief: a section streams in while its inquiry settles it, and the outline fills with the section's headings as they arrive](https://raw.githubusercontent.com/lloyal-ai/lloyal-ai/main/.github/readme/write.jpg)

*An app generated from the deep-research template. What it does is one example of what a harness can do; the
program underneath is yours to change.*

## An example: three commands to a living brief

`new` starts you from a template. There are two, and each generated project carries its own README with its
recipes: **wiki** (`--template basic`, [its README](https://github.com/lloyal-ai/lloyal-ai/blob/main/templates/basic/README.md)),
a small Wikipedia app, and **deep-research** (`--template research`,
[its README](https://github.com/lloyal-ai/lloyal-ai/blob/main/templates/research/README.md)), a grounded
multi-agent investigation. More are coming. Everything in this section is deep-research, because it shows the
most in the least time.

```sh
npx lloyal-ai@alpha new my-app --template research
cd my-app
npm run dev:desktop
```

The first launch fetches and verifies three weights: a 4B reasoning model, a 0.6B reranker that scores what the
agents read, and a vision projector so the model can see. The app shows each step as it happens, with the bytes,
the rate and the time left, and lets you point a step at a file you already have. Every launch after that opens
at once. Then ask it something worth investigating.

Watch what appears. The outline drafts itself, line by line, from the planner's own stream — and editing a line
*is* editing the plan. Sections fill in place, each carrying its line of inquiry: searching, reading, waiting
honestly through a rate limit, writing. Click any inquiry open to watch the model think. Hold the run, drop a
line, or close the brief early and keep what it has. When it settles, the document takes the room: citation
chips, a sources grid, the deliberation on request. Ask a follow-up and it answers from a context that is still
warm.

Drop a PDF on it. The text is searched and read; a page the model needs to *look at* is projected only when it
reaches for it; and every citation points at a page you can open. Ask about a figure.

Every settled brief joins a library the next brief can search, cite and build on.

In this template the journey is four moments, and the same four words name them in its code: **Ask · Frame
· Write · Settle.**

| Ask | Frame | Write | Settle |
| --- | --- | --- | --- |
| ![Ask: one question, and the shape it takes](https://raw.githubusercontent.com/lloyal-ai/lloyal-ai/main/.github/readme/ask.jpg) | ![Frame: the outline, held for your edits](https://raw.githubusercontent.com/lloyal-ai/lloyal-ai/main/.github/readme/frame.jpg) | ![Write: inquiries searching and reading, side by side](https://raw.githubusercontent.com/lloyal-ai/lloyal-ai/main/.github/readme/write-searching.jpg) | ![Settle: the brief, its citations and its sources](https://raw.githubusercontent.com/lloyal-ai/lloyal-ai/main/.github/readme/settle.jpg) |

*The deep-research template, from question to settled brief.*

## The one idea underneath

An agent in Lloyal is a **branch** of the model's live state, not a request. Fork the branch that has already
read the evidence and every agent forked from it attends the same cells: an image projected once is seen by all
of them; a shared header is paid for once however many agents run. The runtime decodes every active branch in
one pass and reclaims the whole working tree when the work that owned it ends.

```text
 against an endpoint                      inside lloyal

 agent 1  ▐ evidence ▐ task ▌             evidence ──┬── agent 1: task
 agent 2  ▐ evidence ▐ task ▌                        ├── agent 2: task
 agent 3  ▐ evidence ▐ task ▌                        └── agent 3: task

 the evidence is sent, and paid for,     the evidence is read once; each agent
 once per agent                           forks the attention that read it
```

> Post-training produces a tendency. A harness produces a procedure.

The model supplies language, judgement and learned competence. Your program supplies what exists, what evidence
enters it, when work changes course, what counts as done, and what becomes durable. That program is a
generator: read `function*` as `async function` and `yield*` as `await`, and what you gain is ownership —
whatever a piece of work starts is finished or cleaned up when that work ends, however it ends. That is why a
Stop works in the middle of anything, and why there is almost no teardown code to write.

```text
 session                     the model, resident
 └── harness                 your program; lives exactly as long as the session
     └── run                 one at a time: Stop reaches whatever is here
         └── spine           one shared line of attention: the header, the tools, the evidence
             ├── agent 1     a fork of the spine, with its own task
             ├── agent 2     …
             └── agent N     one more fork, reading what the others found

 whatever a line starts is finished or cleaned up when that line ends:
 the findings leave as data; the branches do not outlive the run
```

## Recipes

Six things you can program here that cannot be programmed against an API key. Each is the outcome first,
then the lines that make it; the full version of every one is under Recipes in the generated project's README.

### Recipe 1 — An LLM and a team of specialist models, coordinating in real time

The reasoning model is one voice among several. Beside it, resident in the same process, a team of
specialists, each doing one thing the reasoning model would do slowly or badly: a judge that answers "is this
relevant?" yes or no, and in what order, in milliseconds; memory that finds the fifty passages nearest a
question across ten thousand; sight that puts a page in front of the reasoning model when the text is not
enough. They coordinate inside a turn. Nothing an agent finds enters the reasoning model's context until the
judge has scored it; memory recalls while the reasoning model writes; sight projects a page the moment the
model reaches for it. Four ship today, named in one file:

```yaml
# harness.yml
model:
  llm:       { id: qwen3.5-4b }                 # reasons and writes
  reranker:  { id: qwen3-reranker-0.6b-q8 }     # the judge: which of these is relevant, in order
  embedding: { id: nomic-embed-text-v1.5-q4 }   # memory: which of ten thousand passages are near this question
  vision:    {}                                 # sight: the projector paired with the reasoning model
```

Coming to the same table: a decision model that routes, scores and classifies without generating a word, in
one pass; a voice model that hears; a dictation model that turns what was said into clean text. Each will be
one more block in this file, reached by the same call as the four above, by your code and by every installed
ability alike.

Naming a block is composing that model: it is fetched and verified before your program runs, and any line of
your code reaches it with one call. An audit over ten thousand contracts, in the framework's grammar:

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

### Recipe 2 — Triage every referral letter in the clinic, and nothing leaves the building

A choice over a known list is a grammar, not a prompt. The reasoning model picks the pathway by NUMBER and
cannot answer anything else, so there is nothing to parse and no "the model said something else"; the judge
beside it ranks every letter against the pathway, so the ones to look at first are known. [Jev](https://boringbot.substack.com/p/the-hype-of-jev-explained-a-deep) raised forty million
dollars to sell that shape as an API, priced per token, your letters uploaded to be scored. Here it is, thirty
lines, on the laptop in the consulting room, and the letter never crosses a network:

```ts
const pick = defineOutput("pathway", z.number().int().min(0).max(pathways.length));
const pool = yield* agentPool({
  systemPrompt: listing,            // the pathways, by number — read once, shared by every letter's agent
  schema: pick.schema,              // the answer IS a number in range
  enableThinking: false,
  acceptFreeText: true,
  orchestrate: parallel(letters.map((letter) => ({ systemPrompt: "", content: letter }))),
});
const pathway = pool.outcomes.map((o) => pick.read(o));
const judge = yield* service("reranker");
const rank = yield* call(() => judge.scoreBatch(pathways[0], letters));   // every letter against one pathway: an ORDER, one pass
```

A thousand letters get a thousand agents, and the list of pathways is read once for all of them. The judge
takes every letter in one batched call per pathway. Its score is an order within one question — the model's
own yes/no log-odds under the instruction — not a calibrated probability: the platform uses it as top-K within a
query, and a floor for it is a discrimination signal you measure for your instruction and your model.

### Recipe 3 — Find the rule in force this year, not the one it replaced

Similarity hands you both: a superseded rule answers the question it was superseded on, and the two are
neighbours in any embedding. Here nothing enters the model's context by distance. A judge is asked a
question in English about every candidate, and the question is yours, in one place:

```yaml
# harness.yml — one sentence, and every ability that reads pages or a corpus admits by it
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

### Recipe 4 — Tighten the rules while the job is running

A compliance officer changes what the agents may search, or turns the paid source on, and every agent already
working obeys at its next call. Nothing stops, nothing restarts, no run is lost. A tool reads its ability's
settings at the call; a knob of your own is declared once and read the same way.

```ts
// src/config.ts — declared once; harness.yml can commit it, the settings pane saves it
"answer.words": { yml: "answer.words", integer: true, default: 400, describe: "How long an answer may run." },

// wherever it is used — read at the call, so a save applies at the next one
const words = config().answer.words;
```

### Recipe 5 — No finding without evidence

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
    return pressure.critical && super.shouldExit(agent, pressure);   // room, never time — and still one agent a tick
  }
}
yield* agentPool({ ...spec, hooks: [EVIDENCE_FIRST], policy: new Patient() });
```

### Recipe 6 — Give the agents the patient record system

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

## Make it yours in three edits

The generated project is source, whichever template it came from. In the deep-research template, three files hold
one concern each, and one folder holds the words — the rest can wait:

```text
 src/
   ui/presentation.ts         ← what it is called
   harness/instructions.ts    ← what it is for
   harness/research.ts        ← how it investigates: `inquire`, one expression
   harness/prompts/           ← what it says: one Eta file per prompt
   ───────────────────────────────────────────────────────────────────
   app.ts                     the app: what is installed, the parts, the loop
   harness/brief.ts           a brief's life: asked · framed · written · settled
   harness/                   plan · write · answer, the library, the prompts
   ui/                        the fold, the selectors, the four moments
```

**What it is called** — `src/ui/presentation.ts`. Every surface reads it: sidebar, window, tab, terminal, host.

```ts
export const APP = { name: "Fieldnote", storage: "fieldnote" } as const;
```

**What it is for** — `src/harness/instructions.ts`. Two sentences, said on every path an answer can take.

```ts
export const INSTRUCTIONS = {
  purpose: "You help maintenance engineers investigate equipment failures.",
  answers: "Lead with the likely cause. Always name the part number.",
};
```

**How it investigates** — `src/harness/research.ts`. The strategy is one stage, `inquire`. Side by side,
one after another on a growing shared context, a fan-out, a dependency graph, or an orchestrator of your own:

```ts
// src/app.ts — hand the brief another strategy; everything else stands
const sideBySide: Research = {
  ...research,
  write: (trunk, ask, plan) =>
    research.write(trunk, ask, plan, {
      inquire: (ask, tasks, spec) => parallel(tasks.map((task, i) => spec(task, i, true))),
    }),
};
const brief = briefs({ session, library, run, wire, config: runner.config, research: sideBySide });
```

**What it says** — `src/harness/prompts/`. Every prompt the app makes is an Eta file there, rendered with
what the stage knows (`it.query`, the sources, the findings); change one and ask the next question. The
project's README says what each file is and what it is handed.

A planner, a settling pass or the whole writer can be replaced the same way: each returns a value, and the
app takes care of the rest. `npm test` runs the app's laws against a scripted model in about two seconds, so a
change is proved without downloading weights. The wiki template is the same idea at a smaller size: one
harness file, one procedure, the same three surfaces.

## What it can become

A spreadsheet that researches each row. A maintenance app that investigates competing explanations for a fault
and keeps the minority lineage alive when its evidence is material. A document app that reads, inspects the
diagrams, and keeps working through follow-ups. An analysis that admits a source only when it governs the
relevant date, so a superseded rule cannot win on relevance alone.

None of these is a mode of the framework, and none is the research template with a different name. Each is a
procedure written in TypeScript over the same primitives — which is what makes a template a starting point
rather than a ceiling.

## One program, three surfaces

The same `harness(ctx, events, commands)` runs unmodified in a terminal, a native window and a browser. One
fold of state, one binding each, no view holding truth.

```text
 terminal ─┐
 window  ──┼──▶ harness(ctx, events, commands) ──▶ the model, in the same process
 browser ──┘
```

| Surface | Run | The model runs in |
| --- | --- | --- |
| A native desktop app | `npm run dev:desktop` | an engine process the window talks to |
| A browser | `npm run dev:web` | a host you serve; browsers connect to it |
| Your terminal | `npm start` | the process itself |

`npx lloyal-ai@alpha new` with no name asks for the name, surfaces, model and template.

## Models

The catalogue, your pins and what is on disk, from the project's root:

```sh
npx lloyal-ai@alpha models:list                        # the catalogue, your pins, what is on disk
npx lloyal-ai@alpha models:use <id> [--role reranker]  # a catalogue model, fetched and verified on the next launch
npx lloyal-ai@alpha models:add <path.gguf> [--role reranker]  # a local weight you already have
```

The reasoning model is a dial. The same harness runs a 4B on a laptop and a frontier model on your own GPU host;
the program does not change. The default set runs on a 16 GB laptop.

On a Linux CUDA host, `new` finds the GPU and runs on it: where the GPU needs the signed CUDA backend pack —
every arch, Blackwell included, verified against the platform key — it is fetched once per lloyal.node version
and shared by every harness on the box. For a project you cloned, `npx lloyal-ai@alpha backends:install` does
the same and writes `model.llm.gpu: cuda` for it.

## Abilities

An **Ability** is an installed capability: tools, the instructions to use them, configuration, and a declaration
of the models it cannot work without. It runs inside the harness and can work with the calling agent's live
context. The harness provides what an ability declares by naming the model in `harness.yml`; `install` tells you
when the project names none and offers to write the line. Deep-research ships with web, corpus and documents.

```sh
npx lloyal-ai@alpha install <publisher>/<name>   # verified and vendored into the project
npx lloyal-ai@alpha ability:new my-ability        # start one of your own
```

Every install is Ed25519-verified against a reviewed catalogue: what you install is what was reviewed. Point the
corpus at `reports` in `harness.yml` and the app reads what it has written.

## Requirements

Node.js 24 or newer. Web search needs the network; everything else — documents, images, the library — works
offline once the weights are on disk. This is an alpha: `npx lloyal-ai@alpha` pins you to it. Outside an
interactive terminal, run `npm install` in the project yourself.

## Go deeper

- [Thinking in Lloyal](https://docs.lloyal.ai/thinking-in-lloyal) — the execution model: ownership, live state, control at explicit boundaries
- [Vertical Inference](https://verticalinference.lloyal.ai/) — the architecture, from the model up
- [The HDK](https://github.com/lloyal-ai/hdk) — the runtime packages
- [Issues](https://github.com/lloyal-ai/lloyal-ai/issues)

## Licence

The CLI is MIT. The application you generate is yours to license as you choose. The HDK runtime packages carry
their own licence and the [Lloyal Harness Builder Grant](https://github.com/lloyal-ai/hdk/blob/main/GRANT.md),
under which building, distributing, selling and hosting a harness or an ability is always permitted. Model
weights carry their respective licences.
