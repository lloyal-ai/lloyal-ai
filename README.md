# lloyal

**What becomes possible when the model and the program live in the same process?**

Most AI code is a client: it sends a request to a model somewhere and waits. Lloyal puts the model *inside* the
application, so your code has control *through* inference, not only around it. It can fork the model's live
attention into several agents at once, hand each different evidence, decide what the next stage inherits, and
commit only what it accepts. Every one of those decisions is ordinary TypeScript, and it runs on hardware you
own — a laptop today, your own GPU host when you serve it. No API key on the path that thinks.

Think of a game engine. You program the behaviour; Lloyal handles the physics underneath.

## Thirty seconds to a living brief

```sh
npx lloyal-ai@alpha new my-app --template research
cd my-app
npm run dev:desktop
```

The first launch fetches and verifies three weights: a 4B reasoning model, a 0.6B reranker that scores what the
agents read, and a vision projector so the model can see. Then ask it something worth investigating.

Watch what appears. The outline drafts itself, line by line, from the planner's own stream — and editing a line
*is* editing the plan. Sections fill in place, each carrying its line of inquiry: searching, reading, waiting
honestly through a rate limit, writing. Click any inquiry open to watch the model think. Hold the run, drop a
line, or close the brief early and keep what it has. When it settles, the document takes the room: citation
chips, a sources grid, the deliberation on request. Ask a follow-up and it answers from a context that is still
warm.

Drop a PDF on it. The text is searched and read; a page the model needs to *look at* is projected only when it
reaches for it; and every citation points at a page you can open. Ask about a figure.

Every settled brief joins a library the next brief can search, cite and build on.

## The one idea underneath

An agent in Lloyal is a **branch** of the model's live state, not a request. Fork the branch that has already
read the evidence and every agent forked from it attends the same cells: an image projected once is seen by all
of them; a shared header is paid for once however many agents run. The runtime decodes every active branch in
one pass and reclaims the whole working tree when the work that owned it ends.

> Post-training produces a tendency. A harness produces a procedure.

The model supplies language, judgement and learned competence. Your program supplies what exists, what evidence
enters it, when work changes course, what counts as done, and what becomes durable. That program is a
generator: read `function*` as `async function` and `yield*` as `await`, and what you gain is ownership —
whatever a piece of work starts is finished or cleaned up when that work ends, however it ends. That is why a
Stop works in the middle of anything, and why there is almost no teardown code to write.

## Make it yours in three edits

The generated project is source. Three files, one concern each:

**What it is called** — `src/ui/presentation.ts`. Every surface reads it: sidebar, window, tab, terminal, host.

```ts
export const APP = { name: "Fieldnote", storage: "fieldnote" } as const;
```

**What it is for** — `src/research/instructions.ts`. Two sentences, said on every path an answer can take.

```ts
export const INSTRUCTIONS = {
  purpose: "You help maintenance engineers investigate equipment failures.",
  answers: "Lead with the likely cause. Always name the part number.",
};
```

**How it investigates** — `src/research/research.ts`. The strategy is one stage, `inquire`. Side by side,
one after another on a growing shared context, a fan-out, a dependency graph, or an orchestrator of your own:

```ts
// src/app.ts — hand the brief another strategy; everything else stands
const algorithm: Research = {
  ...research,
  write: (trunk, ask, plan) =>
    research.write(trunk, ask, plan, {
      inquire: (ask, tasks, spec) => parallel(tasks.map((task, i) => spec(task, i, true))),
    }),
};
```

A planner, a settling pass or the whole writer can be replaced the same way: each returns a value, and the
app takes care of the rest. `npm test` runs the app's laws against a scripted model in about two seconds, so a
change is proved without downloading weights.

## What it can become

A spreadsheet that researches each row. A maintenance app that investigates competing explanations for a fault
and keeps the minority lineage alive when its evidence is material. A document app that reads, inspects the
diagrams, and keeps working through follow-ups. An analysis that admits a source only when it governs the
relevant date, so a superseded rule cannot win on relevance alone.

None of these is a mode of the framework. Each is a procedure written in TypeScript over the same primitives
the research app uses — which is what makes the research app a starting point rather than a ceiling.

## One program, three surfaces

The same `harness(ctx, events, commands)` runs unmodified in a terminal, a native window and a browser. One
fold of state, one binding each, no view holding truth.

| Surface | Run | The model runs in |
| --- | --- | --- |
| A native desktop app | `npm run dev:desktop` | an engine process the window talks to |
| A browser | `npm run dev:web` | a host you serve; browsers connect to it |
| Your terminal | `npm start` | the process itself |

`npx lloyal-ai@alpha new` with no name asks for the name, surfaces, model and template. `--template basic` is
the smaller Wikipedia starter.

## Abilities

An **Ability** is an installed capability: tools, the instructions to use them, configuration, and any models
it needs. It runs inside the harness and can work with the calling agent's live context. Research ships with
web, corpus and documents.

```sh
npx lloyal-ai@alpha install <publisher>/<name>   # verified and vendored into the project
npx lloyal-ai@alpha ability:new my-ability        # start one of your own
```

Every install is Ed25519-verified against a reviewed catalogue: what you install is what was reviewed. Point the
corpus at `reports` in `harness.yml` and the app reads what it has written.

## Models

```sh
npx lloyal-ai@alpha models:list            # the catalogue, your pins, what is on disk
npx lloyal-ai@alpha models:use <id>        # a catalogue model, fetched and verified on the next launch
npx lloyal-ai@alpha models:add <path.gguf> # a local weight you already have
```

The model is a dial. The same harness runs a 4B on a laptop and a frontier model on your own GPU host; the
program does not change. The default set runs on a 16 GB laptop.

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
