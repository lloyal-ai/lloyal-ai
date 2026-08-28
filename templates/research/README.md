# __NAME__

A deep-research harness that writes **living briefs** — documents that
assemble themselves in front of the reader. The models live *inside* the
app: no API key, and nothing on the inference path touches the network.

Ask a question and the brief begins. The outline drafts itself from the
planner's own stream, and editing it — rewrite a line, strike one, add
one — IS editing the plan. Sections fill in place, each carrying its line
of inquiry: searching, reading, waiting honestly through a rate limit,
writing. Click any inquiry open to watch the model think. Hold the run,
drop a line, or close the brief early and keep what it has. When it
settles, the document takes the room — citation chips, a sources grid,
the deliberation on request — and every settled brief joins a library
that the next brief can search, cite, and build on.

> **SNAPSHOT: reasoning.run @ 0.8.0.** This template is a curated copy of
> reasoning.run's RACE/DRB-tuned pipeline, conforming to the `lloyal new`
> conventions — a real, editable starter, not a dependency. Drift from
> upstream is expected.

## Run it

```sh
npm install
npm start
```

Two models are fetched and **digest-verified** on first run — no key: the
reasoning LLM into `models/llm/`, and the reranker the sources score
retrievals with into `models/reranker/`. (Prefer your own weight? Drop a
`.gguf` in the role folder, or point a `path:` in `harness.yml` at one.)

The SAME harness runs on three surfaces — same
`harness(ctx, events, commands)`, same fold, a different binding:

```sh
npm start             # a terminal app (Ink)
npm run dev:desktop   # a native window (Electron): forks this cli as the engine
npm run serve         # a local host serving browsers over ws://127.0.0.1:8787
npm run dev:web       # …and the browser app that talks to it (Vite, :5173)
```

Set `LLOYAL_DEV=1` to dock the dev pane under the web/desktop view: an
agent timeline with per-token epistemics, the retrieval funnel, compiled
prompts, and live context/cpu/mem charts.

`npm start` builds with **esbuild** (`--loader:.eta=text`) rather than
plain `tsc`, because the harness inlines the tuned prompt templates from
`prompts/*.eta`.

## How the harness works

The platform contract is one generator:

```
harness(ctx, events, commands)
```

`ctx` is the resident model. `events` streams `WorkflowEvent`s to
whatever surface is mounted; `commands` delivers that surface's
`Command`s back. Everything the user sees is a fold of the event stream
— `harness/reducer.ts` turns events into ONE `AppState` that the Ink
view, the desktop main process, and the browser page all share — and
everything the user does is a command: `submit_query`, `accept_plan`,
`pause`, `wrap_up`, `cancel_agent`, `library_read`. No view holds truth;
no view calls the model.

Inside, the pipeline runs: a pre-flight **recon** probe of each source →
the **planner** (its plan held for review; your edits mutate it through
plan commands) → a **research pool** of agents, parallel for a Survey or
chained over a shared KV spine for an Investigation, each retrieval
scored by the reranker before it enters context → **synthesis** into one
voice, citations woven inline. Time and context budgets come from the
effort presets; the minutes the pickers quote are learned from what YOUR
machine actually does (`targets/_shared/pace.ts`).

## The library learning loop

Every settled brief is written to `reports/` — `report.md` (the woven
answer) plus one annexure per inquiry, references included. The corpus
ability points at that same directory (`harness.yml`), so the system
reads what it has written:

1. A brief settles → its run dir lands in `reports/` → the corpus
   re-indexes.
2. The next question's recon probes the corpus and finds it; the planner
   routes tasks at past briefs *by name*; agents search and read them
   like any source; the new brief cites the old one.
3. Clicking a report in the sidebar RESTORES it as the session document
   — asking over it prefills the report into the model's context, so
   follow-ups are warm. The trash deletes a brief's whole run dir and
   re-indexes: the system unlearns it.

If you know [Hermes Agent's memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory),
this is the same family — an agent's own files on disk feeding its
future sessions — with one deliberate difference: Hermes distills
trajectories into skills and curated memories the agent loads; this
harness keeps the **whole evidential product** and re-enters it at
retrieval time through the reranker. Memory as evidence, not technique:
nothing is summarized away, relevance is judged per question, and
forgetting is a user gesture.

## The shape

```
harness/               your program (node-free where views fold it)
  harness.ts           ← the command loop + ability boot: start here
  pipeline.ts          recon → plan → research → synth, + policies
  protocol.ts          the events (↓) and commands (↑) your harness speaks
  state-core.ts        AppState — the ONE fold every target shares
  reducer.ts           reduce(state, event) → AppState
  effort-presets.ts    Quick/Standard/Thorough as plain data
  run-dir.ts           writes reports/<timestamp>/report.md + annexures
  config.ts            your harness.yml schema + env/yml layering
  served-runtime.ts    per-session compute glue (context build, gpu steer)
prompts/               the 7 RACE/DRB-tuned .eta prompts — drop a file to
                       override one; empty = the baked defaults
targets/
  _shared/             the React view (desktop + web mount the same one)
    App.tsx            thin: moment table + dev pane mount — grow it
    theme.ts           the visual register as data: palette, type, motion
    select.ts          THE seam: AppState → the brief's language; above
                       this file no identifier says "agent"
    store.ts           zustand wrapping the one fold (bridge + replay)
    pace.ts            observed minutes-per-inquiry, per machine
    moments/           one component per moment: Ask · Frame · Write · Settle
    parts/             the grammar: Shell, Composer, Library, InquiryRow,
                       OutlineRail, Prose, Sources
  cli/                 boot + the terminal view (Ink) — swap or keep
  desktop/             Electron shell over the ipc binding
  web/                 serve.ts host + browser boot over the wss binding
models/                resident weights (fetched on first run; gitignored)
vendor/                signed Abilities — Ed25519-verified tarballs, committed
reports/               your settled briefs — the library AND the memory
harness.yml            targets, models, output dir, ability config
```

## Where to begin

Ordered by ambition — each step is one file:

1. **A prompt** — copy any of the seven into `prompts/<name>.eta` and
   edit; the override wins, byte-identical otherwise.
2. **The register** — `targets/_shared/theme.ts` is the whole look as
   data. Change the accent, the faces, the motion.
3. **A derivation** — `targets/_shared/select.ts` is where machinery
   becomes language ("Searched — 8 results · en.wikipedia.org"). Add a
   selector, render it in a moment.
4. **A moment** — `moments/` and `parts/` are plain React over the fold.
   The cli's Ink view (`targets/cli/view.tsx`) folds the same state.
5. **The pipeline** — `harness/pipeline.ts` owns what the intelligence
   does: policies, budgets, the orchestration shapes.
6. **A capability** — `npx lloyal-ai install <publisher>/<name>`, then
   add its factory to `abilities` in `harness/harness.ts`.

## Configuration

`harness.yml` is committed with the project — targets, models,
`sources.outputDir` (default `reports/`), per-ability config. Settings
the app saves at runtime (effort, output dir) layer into `harness.json`,
gitignored. Secrets go in the environment, never in yml — set
`TAVILY_API_KEY` for keyed web search; without it the web ability runs
on a keyless fallback.

## Licence

This project is yours — add whatever licence your organisation needs.
The scaffolding that produced it is MIT and imposes nothing on your code.

Your use of the HDK runtime (`@lloyal-labs/*`) is covered by the
Functional Source License plus the
[Lloyal Harness Builder Grant](https://github.com/lloyal-ai/hdk/blob/main/GRANT.md),
under which building, distributing, selling and hosting a harness or an
ability is always permitted and is never a Competing Use — including in
direct competition with Lloyal's own products.
