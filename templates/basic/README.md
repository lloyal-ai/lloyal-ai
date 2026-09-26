# __NAME__

A vertical inference harness. The model lives *inside* the app — no API key, and nothing on the inference path touches the network.

## Run it

```sh
npm install
```

Then start a surface — each folds the same harness:

__RUN_STEPS__

The recommended model is fetched and **digest-verified** into `models/llm/` on first run — no key. (Prefer your own weight? Drop a `.gguf` in `models/llm/`, or point `model.llm.path` in `harness.yml` at one.) Type a question and watch two agents read Wikipedia in parallel while a settling agent folds their notes into one article.

The **web** surface is two processes — a resident-model **host** and a browser client; `npm run dev:web` starts both (the browser reconnects until the host is up). To run the host on its own (a remote box, or the browser elsewhere), use `npm run serve` + `npm run dev:web:client`. For a fast cli loop without a build step, use `npm run dev`.

## The shape

Folders are roles; the files inside them are your domain.

```
src/
  app.ts          what this app IS: its abilities, its config, its harness
  config.ts       the knobs, as data
  protocol.ts     the events (↓) and commands (↑) your harness speaks
  harness/        ← your program
    wiki.ts       what the MODEL does: two angles, a shared spine, a settling pass
    article.ts    an article's life — and the only place the trunk is written
    classify.ts   the shelf's topics: named once, then each article filed by its own agent
    prompts.ts    Eta reads prompts/ ; an edit is live at the next question
    prompts/      one .eta file per prompt — the words, editable
    instructions.ts   who this app is for, in the model's ear
  ui/             ← your view
    state.ts      node-free reduce(events) → AppState (every view folds it)
    App.tsx       the React view (desktop + web)
    cli.tsx       the Ink view (terminal)
    presentation.ts   what the app is called, said once
  common/util.ts  stateless helpers both halves use
targets/
  <surface>/      one thin entry per surface — cli · desktop · web
                  each is one call to the boot that owns it
test/
  invariants/     behaviour, over the real harness and the real reduce
models/
  llm/            the resident model (fetched on first run; gitignored)
vendor/           signed Abilities — Ed25519-verified tarballs, committed
harness.yml       targets + model
```

Everything under `targets/` is convention handled for you — the boot mounts a view over a binding; a view is a sink that folds `reduce`. The centre is `src/harness/`: `wiki.ts` is where you program what your intelligence does — which agents exist, how they collaborate, what they trust, when work is done — and it returns an article without ever writing the model's memory. `article.ts` decides what becomes of it. `basic` runs a `parallel` pool + a settling pass; `chain` is a one-line swap.

## Make it yours

Three edits change what this app is:

- **`src/ui/presentation.ts`** — its name, everywhere.
- **`src/harness/instructions.ts`** — who it is for, and what its answers must do. Every prompt that is framed says them.
- **`ANGLES` in `src/harness/wiki.ts`** — the two angles it reads from. A real harness would *compute* these; this one keeps them static so the file reads top to bottom.

Then the words themselves: `src/harness/prompts/` holds one `.eta` file per prompt, read from disk each time, so an edit reaches the next question with no restart and no rebuild.

## Recipes

Each one fits on a screen, and each one runs on the model you already have — no key, no hosted service,
nothing on the network. They are the shape of the framework, shown rather than described.

### Classify anything with the resident model

`src/harness/classify.ts` is a decision model, not a text generator: it files every saved article under a
topic by answering a NUMBER. [Jev](https://boringbot.substack.com/p/the-hype-of-jev-explained-a-deep) sells exactly this shape as a hosted service — pick the best answer
from a list you give it, no freeform text, fast. Here it is thirty lines, and all of them are
already in your scaffold:

```ts
const pick = defineOutput("topic", z.number().int().min(0).max(topics.length));
const pool = yield* agentPool({
  systemPrompt: render("topic.system", { topics }),   // the list, by number, on the spine
  schema: pick.schema,          // the grammar: the answer IS a number in range
  enableThinking: false,        // nothing reasons before it
  acceptFreeText: true,
  orchestrate: parallel(listings.map((article) => ({ systemPrompt: "", content: render("topic.user", { article }) }))),
});
return pool.outcomes.map((outcome) => pick.read(outcome));
```

The grammar means the model cannot emit anything but a number in range, so there is nothing to parse and no
"the model said something else". The pool means every item's agent forks from ONE spine that holds the option
list, so the list is paid for once however many items there are, and they decode together. To classify
anything else, change three things: the options, the schema (`z.enum([...])` reads as well as a number), and
what each agent is shown. Ranking the picks by how well each letter fits its pathway is a second model's job,
and it is one call away:

### A second model as a service

Name it in `harness.yml` and it is acquired, digest-verified and bound before your harness runs:

```yaml
model:
  llm:
    id: qwen3.5-4b
  reranker:
    id: qwen3-reranker-0.6b-q8
```

Then read it anywhere in your harness — no plumbing, nothing to declare:

```ts
import { service } from "@lloyal-labs/rig";
import { call } from "effection";

export function* rankAgainst(question: string, candidates: string[]) {
  const reranker = yield* service("reranker");
  const logOdds = yield* call(() => reranker.scoreBatch(question, candidates));
  return logOdds.map((s) => 1 / (1 + Math.exp(-s)));   // the model's P(yes) per candidate: an order within this question
}
```

`scoreBatch` answers the reranker's own yes/no log-odds per candidate, and the sigmoid is the model's own
P(yes) under the instruction: an order within one question, not a probability comparable across questions.
The platform uses it as top-K within a query; a floor for it is a discrimination signal you measure for your
instruction and your model, never a global cutoff. The judge, resident, beside the generator. Remove the block
and the service is gone; an installed Ability that requires it is refused by name at enable, and your harness
still starts. Vision is the same one line (`vision: {}` takes the projector paired with your model). A new
KIND of service is one row in the platform's table, not a new wiring — [services](https://docs.lloyal.ai/services).

The question the judge answers is yours too, in the same block: `model.reranker.instruction` carries the
sentence and a canary pair that refuses the boot if the sentence stops discriminating. The deep-research
template's README walks one that is measured on this judge, the rule in force on a date against the one it
superseded.

### A tool that lives in your harness

A tool is a class with a name, a description, a JSON schema and an `execute`. An Ability ships tools, and so
can `src/harness/`. This one answers a term of art, and carries a gate of its own:

```ts
import { Tool } from "@lloyal-labs/lloyal-agents";
import type { JsonSchema, ToolGuard, ToolLifecycleHooks } from "@lloyal-labs/lloyal-agents";
import type { Operation } from "effection";

/** Its own gate: the same term is not looked up twice by one agent. */
const onePerTerm: ToolGuard = {
  name: "glossary_once",
  reject: ({ args, attended }) => attended().some((a) => a.term === args.term),
  message: "You already looked that term up. Use what it said.",
};

export class GlossaryTool extends Tool<{ term: string }> {
  readonly name = "glossary";
  readonly description = "What this organisation means by a term of art.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: { term: { type: "string", description: "The term, as written" } },
    required: ["term"],
  };
  readonly hooks: ToolLifecycleHooks = { beforeDispatch: [onePerTerm] };
  constructor(private readonly glossary: Record<string, string>) { super(); }
  *execute(args: { term: string }): Operation<unknown> {
    return this.glossary[args.term.toLowerCase()] ?? { error: `no entry for "${args.term}"` };
  }
}
```

Add it to the `tools` array in `src/harness/wiki.ts` and it is on the spine every angle forks from —
advertised once, callable by every agent:

```ts
const tools = [...abilities.flatMap((a) => [...a.tools]), new GlossaryTool(GLOSSARY), citedReport.tool];
```

### Steer the agents with hooks

Every tool call passes through one lifecycle — may it run (`beforeDispatch`), did it count as an
attempt (`afterExecute`), does its result fit (`beforeAdmit`), it is in (`afterAdmit`), the turn is over
(`onReturn`) — and a hook is a plain object with an opinion at any of those positions. The tool's own gates
run first, then the harness's hooks in order, then the framework's defaults; the first concrete decision
wins, and `undefined` abstains.

`wiki.ts` already carries one:

```ts
const EVIDENCE_FIRST: ToolLifecycleHooks = {
  onReturn: ({ agent }) =>
    agent.toolCallCount < 1 ? { type: "reject", message: EVIDENCE_REJECTION } : undefined,
};
// … agentPool({ …, hooks: [EVIDENCE_FIRST] })
```

An angle that reports before it has read anything is refused once and told why; its second report stands.

The pool's larger decisions — when an agent must stop, whether a tool result is scored against the original
question or only the agent's own, what becomes of an agent reaped without a result — are an `AgentPolicy`.
`agentPool` derives one from `budget`; hand it your own instead, overriding the one decision you care about:

```ts
import { DefaultAgentPolicy } from "@lloyal-labs/lloyal-agents";
import type { Agent, ContextPressure } from "@lloyal-labs/lloyal-agents";

class Patient extends DefaultAgentPolicy {
  shouldExit(agent: Agent, pressure: ContextPressure): boolean {
    // Only ever for room, never for time — and under pressure still the default's one agent a tick, so a
    // cohort is never reaped together.
    return pressure.critical && super.shouldExit(agent, pressure);
  }
}
// … agentPool({ …, policy: new Patient() })   — in place of `budget`
```

Every hook the pool calls, with its default, is [agent policy and context pressure](https://docs.lloyal.ai/agent-policy-and-context-pressure).

### A setting of your own, live

Declare a key in `src/config.ts` and it exists everywhere a setting does: `harness.yml` can commit it, the
dev pane (`LLOYAL_DEV=1`) lists and saves it, and `config:loaded` reports where its value came from:

```ts
"answer.words": { yml: "answer.words", integer: true, default: 400, describe: "How long a settled article may run." },
```

Read it where you use it, not at boot — `runner.config().answer.words`, handed down as a function the way
`app.ts` hands `article.ts` its `root` — and a save applies at the next read, under a live run, with nothing
restarted. That is the rule an Ability's settings follow too: a key saved mid-run reaches the next call of
every agent already running.

## What it keeps, and what it does not

A settled article is written to `sources.outputDir`: `article.md` first, then a small `article.json` record — and the record's existence is what makes the folder an article, so a crash midway leaves nothing half-kept. Past articles appear on the landing, grouped by topic: the list paints immediately and rearranges when the resident model answers, because nothing on screen waits for a model call. Open one and it is the page again — a question asked there deepens it, with the model's memory rebuilt from the record. The name at the top returns to the landing, where a question starts a new article.

Two limits worth knowing before you meet them:

- **A reopened article brings back its words, not its sources.** The record keeps four facts — the question, when, the version and the article — so the pages the agents read, and the agents themselves, belong to the turn that wrote it.
- **The terminal reports the count and leaves browsing to the other two surfaces.** One fold serves all three bindings, but a reflow into topics is not something a scrolling view can show honestly.

## Add capabilities

```sh
npx lloyal-ai install <publisher>/<name>   # a signed Ability from apps.lloyal.ai
```

Enable it in `src/app.ts`, in the `abilities` array alongside `createWikipediaAbility`.

**Abilities never come from npm.** They are distributed through the signed
channel: `install` fetches the tarball, checks its Ed25519 signature against the
trust roots shipped with the framework, writes it to
`vendor/<publisher>__<name>-<version>.tgz` beside the signed manifest it was
checked against, and only then points `package.json` at those exact bytes:

```json
"@lloyal-labs/wikipedia-ability": "file:vendor/lloyal__wikipedia-2.0.4.tgz"
```

That `file:` line is the whole reason an Ability appears in `package.json` at
all — it is how npm is told to materialise bytes the CLI has already verified,
never an instruction to fetch anything. Commit `vendor/` and `npm ci` reproduces
those exact bytes from the repo — the Ability is the one dependency that never
reaches the network, whatever else the install resolves from the registry.

So the version is pinned to a file: upgrading is another `install`, not a range
that drifts. And `lloyal new` records what it installed under
`harnessdev.abilities` — that list is what the launcher reads back to name the
exact `install` commands when a clone is missing an Ability its code imports.
If you scaffolded with `--skip-install`, fetch the default one with
`npx lloyal-ai install lloyal/wikipedia` before the first run.

## Licence

This project is yours — add whatever licence your organisation needs. The
scaffolding that produced it is MIT and imposes nothing on your code.

Your use of the HDK runtime (`@lloyal-labs/*`) is covered by the Functional
Source License plus the [Lloyal Harness Builder Grant](https://github.com/lloyal-ai/hdk/blob/main/GRANT.md),
under which building, distributing, selling and hosting a harness or an ability
is always permitted and is never a Competing Use — including in direct
competition with Lloyal's own products.
