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

**Two different "multi", and this project has both.** They are worth
keeping apart, because they solve different problems:

- **Multi-modal** — the question can carry pixels and pages, not just
  text. Attach a photo or a PDF and the model looks at it. A vision
  projector sits beside the reasoning model; an attached image goes into
  context as pixels; a document is searched and read as text, and any
  page of it can be put in front of the model's eyes on demand, one page
  at a time, when the text is not enough.
- **Multi-surface** — the same `harness(ctx, events, commands)` runs
  unmodified in a terminal, a native window and a browser. One fold,
  three bindings, no view holding truth.

> **Its name.** `src/ui/presentation.ts` says what this app is called, once:
> the sidebar, the browser tab, the desktop window, the terminal and the
> served host all read it. Rename it there. The `storage` key beside it
> prefixes what a browser remembers for a reader (their open panel, this
> machine's pace); leave it alone when you rename, or those are forgotten.
>
> **Lineage.** Evolved from reasoning.run 0.8.0's RACE/DRB-tuned
> pipeline — a real, editable starter, not a dependency. Its document model
> is its own; the design record is `docs/document-identity.md`.

## Run it

```sh
npm install
npm start
```

Two models are fetched and **digest-verified** on first run — no key: the
reasoning LLM into `models/llm/`, the reranker the sources score
retrievals with into `models/reranker/`, and a vision projector into
`models/mmproj/` so the model can see. (Prefer your own weight? Drop a
`.gguf` in the role folder, or point a `path:` in `harness.yml` at one.)

The same `harness(ctx, events, commands)` runs on every surface this
project kept — one fold, a different binding each time:

__RUN_STEPS__

Set `LLOYAL_DEV=1` to dock the dev pane under the web or desktop view: an
agent timeline with per-token epistemics, the retrieval funnel, compiled
prompts, and live context, cpu and memory charts.

## Attach something

Drop a photo or a PDF on the composer and ask about it. What happens next
is the part worth understanding, because **a picture and a document are
not treated the same way, and neither one rides the event wire.**

**Bytes go to a store, not to the model.** An attachment is posted to the
content plane, which sniffs its type, normalises an image or reads a PDF
into pages, and commits the bytes as blobs under `media/` — an **OCI
Image Layout**, the same on-disk format a container registry uses. Every
blob is named by its own `sha256:` digest, so the asset's identity IS its
content. Nothing after that moment moves bytes: commands, events and the
library all carry the digest.

**Three things can enter the model's attention, and each is paid for
differently.**

An **attached image** is projected once, up front, onto the trunk by
`prefillUserMultimodal`. Every agent forked from that trunk attends the
same cells, so **N agents cost one projection** rather than N. The
per-image detail floor and ceiling are yours — `imageMinTokens` and
`imageMaxTokens` in `harness.yml`. Grounding tasks want detail; wide
fan-outs want room.

A **document's text** is staged: listed on the shared spine so every
agent knows it is there, costing nothing until one reaches for it. Then
two tools, and both are more careful than they look.

- `search_documents` narrows lexically with BM25 first, because a
  cross-encoder's cost is linear in candidates, then reranks and keeps
  the best few within a token budget. It always scores in **explore**
  stance, deliberately: the run's exploit stance exists to keep off-topic
  web pages out, but an attached document *is* the on-topic universe, and
  scoring against the original question would veto the passage that
  answers a sub-question of it.
- `read_document` returns the exact text, and **only the part this agent
  has not already read** — subtracting what it and its ancestors attend
  over. Ask for a page and you get the whole sections that touch it, so a
  table split across a page break stays whole.

A **document's pages** are projected selectively, by the agent, when text
is not enough. `view_page` hands the model that page as an image — or one
figure on it, by number. It returns a descriptor rather than bytes: the
pool resolves it through the store and admits it on the media rail. A
rule decides which pages are worth the cells at all — page one always, a
page with no extractable text, one carrying images, drawings, tagged
tables or tagged figures — and a text-only page refuses and points back
at `read_document`.

That last economy is the one to notice. The model does not get a PDF
rendered into its context. It reads, decides a figure matters, and spends
the cells on that one page.

**Citations reach a page.** All three tools hand the model a ready-made
`attachment://<digest prefix>/page/<n>`, so it copies a citation rather
than inventing one. The view resolves the prefix against digests it
already holds, and exactly one digest may answer — a truncated prefix is
either unambiguous or it is not a citation at all. Click it and the page
opens.

Four laws in `test/invariants/documents.scenario.test.ts` pin the
behaviour, and they are the clearest statement of it:

```
a document on the question: listed on the spine, recorded on the meta
  line, never projected
an image beside a document is projected exactly once, on the trunk —
  a warm ask adds nothing
a model with no projector still takes a document — sight is asked only
  of pixels
reopen restores the document; a warm ask stages it again; a cold submit
  does not
```

## How the harness works

The platform contract is one generator:

```
harness(ctx, events, commands)
```

`ctx` is the resident model. `events` streams `WorkflowEvent`s to
whatever surface is mounted; `commands` delivers that surface's
`Command`s back. Everything the reader sees is a fold of the event stream
— `src/ui/reduce.ts` turns events into ONE `AppState` that the Ink view,
the desktop main process and the browser page all share — and everything
the reader does is a command: `submit_query`, `accept_plan`, `pause`,
`wrap_up`, `cancel_agent`, `open_doc`. No view holds truth; no view calls
the model.

Inside, the algorithm runs: a pre-flight **recon** probe of each source →
the **planner** (its plan held for review; your edits mutate it through
plan commands) → a **research pool** of agents, parallel for a Survey or
chained over a shared KV spine for an Investigation, each retrieval
scored by the reranker before it enters context → **synthesis** into one
voice, citations woven inline. Every number it obeys is in one file,
`src/research/budgets.ts`; the minutes the pickers quote are learned from
what YOUR machine actually does.

## The library learning loop

Every settled brief is written to `reports/` — `report.md` (the woven
answer) plus one annexure per inquiry, references included. Point the
corpus ability at that same directory and the system reads what it has
written. The corpus ships installed but off, because it needs a path
before it can run: uncomment `abilities.corpus.corpusPath: reports` in
`harness.yml`, or set it from the corpus chip's settings in the composer.
Then:

1. A brief settles → its folder lands in `reports/` → the corpus
   re-indexes.
2. The next question's recon probes the corpus and finds it; the planner
   routes tasks at past briefs *by name*; agents search and read them
   like any source; the new brief cites the old one.
3. Clicking a report in the sidebar RESTORES it as the session document —
   asking over it prefills the report into the model's context, so
   follow-ups are warm, and the images it carried are staged again. The
   trash deletes a brief's whole folder and re-indexes: the system
   unlearns it.

This is the same learning loop that made
[Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
the local agent to beat — an agent's own files on disk feeding its future
sessions — with one deliberate difference. Hermes distills trajectories
into skills and curated memories the agent loads; this harness keeps the
**whole evidential product** and re-enters it at retrieval time through
the reranker. **Memory as evidence, not technique**: nothing is
summarized away, relevance is judged per question, and forgetting is a
reader's gesture.

## Read it in this order

Follow one question through the app. The same four words — **Ask · Frame ·
Write · Settle** — name the same four moments of a brief's life in every
file below: the brief's sections, the selectors' modules, the view's
components.

1. `src/app.ts` — the whole app in one generator: what is installed, the
   three parts, the command loop. Start here.
2. `src/brief/protocol.ts` — everything a reader can do (`Command`) and
   everything a view is told (`WorkflowEvent`). The table of contents.
3. `src/brief/brief.ts` — what happens when the reader does each thing.
   Its handlers come first, grouped by moment; how each is done is below
   them. This is where you see why a Stop is always heard, and why an
   attached image costs one projection however many agents look at it.
4. `src/research/research.ts` — what the model does: `plan`, `write`,
   `answer`. `inquire` is the whole strategy — side by side or one after
   another — in one expression, and every stage can be replaced alone.
5. `src/ui/reduce.ts`, then `src/ui/select.ts`, then `src/ui/moments/` —
   events become one state, state becomes the brief's language, language
   becomes four components. No view holds truth, which is why the
   terminal, the window and the browser cannot disagree.
6. `src/brief/library.ts` — what is kept, and how every settled brief
   becomes ground the next one can search.
7. `targets/` — the payoff: three surfaces, each a boot entry of a few
   lines over the same `harness`.

## Reading this code

The engine is written with [Effection](https://frontside.com/effection).
You can read it without knowing Effection, with five things in hand:

- **`function*` and `yield*` read as `async function` and `await`.** A
  function that returns `Operation<T>` is one you `yield*`.
- **Whatever an operation starts, it owns.** When it ends — returns,
  fails, or is stopped — everything it started is stopped and cleaned up
  first. That is why there is almost no teardown code here, and why Stop
  works in the middle of anything.
- **Some things are ambient.** `initializeHarness` sets the session up
  once; code further in asks for what it needs (`useWire()`,
  `Ctx.expect()`) instead of having it passed down. Outside a session,
  those throw.
- **A call into the model is wrapped in `waitUntilSettled`.** A stop
  cannot abandon native work half way, so it waits for the call to
  finish before releasing what the call touched.
- **Accepted is not finished.** `run.replace(...)` returns the moment a
  run is accepted, handing back the run. A command handler stops there,
  so the loop stays free; only the one-shot path waits for the run too.

Each of these is explained once in the code, at the place it first
matters. The model's memory has its own two words: the **trunk** is the
running conversation of one brief, and a **spine** is a shared prefix
that a run's agents all fork from, so what is on it is paid for once.

## The shape

```
src/
  app.ts               the app: what is installed, the parts, the loop
  config.ts            what can be configured, declared once as data
  brief/               what a brief is: asked · framed · written · settled
    protocol.ts        everything it says and hears
    brief.ts           its life; the only place the trunk is written
    library.ts         settled briefs on disk
  research/            what the model does
    research.ts        plan · write · answer, and the stages of write
    instructions.ts    what this app is for, in the model's hearing
    budgets.ts         every number it obeys, effort as the one knob
    prompts.ts         the prompts, and the few single sentences
    prompts/           the tuned .eta prompt files
  ui/                  what it looks like
    presentation.ts    what it is called
    reduce.ts          reduce(state, event): the ONE fold every surface shares
    state.ts           the shape of that state
    select.ts          the seam: state → the brief's language
    select/            …one module per moment
    moments/           one component per moment: Ask · Frame · Write · Settle
    parts/             the pieces they are built from
    App.tsx            puts the current moment in the shell
    cli.tsx            the terminal view
    theme.ts           the visual register as data: palette, type, motion
targets/               boot entries only — the platform owns what is below
test/invariants/       the laws, as scenarios over the real harness
media/                 the content-addressed store (OCI Image Layout)
models/                resident weights (fetched on first run; gitignored)
vendor/                signed Abilities — Ed25519-verified tarballs, committed
reports/               your settled briefs — the library AND the memory
harness.yml            models, output dir, ability config, gate scope
```

## Where to begin

**Seeing an edit take effect.** Two halves of this project reload
differently. The view (`src/ui/`) hot-reloads under `npm run dev:web` and
`npm run dev:desktop`. The engine — `src/app.ts`, `src/brief/`,
`src/research/` and the prompts — is bundled once when the dev command
starts, so after editing it, stop the dev command, start it again, and
ask a fresh question. A running session keeps the instructions it was
started with.

Ordered by ambition — each step is one file:

1. **What it is for** — `src/research/instructions.ts` holds two sentences
   of yours: who the app works for, and what every answer must do. They are
   said on every path an answer can take — a direct question, a follow-up,
   a planned investigation — so this is the one edit that makes it your app.
2. **What it is called** — `src/ui/presentation.ts`, read by every surface.
3. **A prompt** — the files in `src/research/prompts/` are yours to edit.
   Their worked examples (immunotherapy trials, voice-agent latency) come
   from the domains this pipeline was tuned on: replace them with examples
   from yours first. `prompts.ts` beside them holds the few single sentences.
4. **A number** — `src/research/budgets.ts` holds every limit the writing
   obeys, with effort as the single knob each row fans out from.
5. **The register** — `src/ui/theme.ts` is the whole look as data.
6. **A derivation** — `src/ui/select.ts` is where machinery becomes
   language ("Searched — 8 results · en.wikipedia.org"). Add a selector,
   render it in a moment.
7. **A moment** — `moments/` and `parts/` are plain React over the fold.
   The terminal view folds the same state.
8. **The algorithm** — `src/research/research.ts` owns what the
   intelligence does, written in the framework's grammar: a spine to fork
   from, a pool that runs agents together, a terminal that ends a turn, a
   settling pass. Hand `app.ts` a different one and everything else stands.
9. **A capability** — `npx lloyal-ai install <publisher>/<name>`, then add
   its factory to `abilities` in `src/app.ts`.

## Documents, routes, and the laws

Every brief is ONE identity — a `docId` minted when you submit — and that
same string names it everywhere: the app's state, the folder on disk
(`reports/<docId>/`), the KV cache's ownership, and on web the address bar
as `/brief/<docId>`. Back and forward navigate documents; a deep link
restores a brief from disk. `docs/document-identity.md` is the design
record — read it before changing how documents are born, switch, or die.

`npm test` runs the behavioural suite in `test/invariants/`: real harness,
scripted model (the sdk's published mock), no weights needed. The
scenarios are the laws, written to be read — what a query births, what an
abort keeps, what may never ride the wire. When you change the harness
they tell you what you broke; when you extend it, add the law you are
promising.

## Configuration

`harness.yml` is committed with the project — models, `sources.outputDir`
(default `reports/`), the scope of each ability's gates, per-ability
config. Settings the app saves at runtime layer into `harness.json`,
gitignored. Secrets go in the environment or the settings pane, never in
yml — set `TAVILY_API_KEY` for keyed web search; without it the web
ability runs on a keyless fallback.

## Licence

This project is yours — add whatever licence your organisation needs.
The scaffolding that produced it is MIT and imposes nothing on your code.

Your use of the HDK runtime (`@lloyal-labs/*`) is covered by the
Functional Source License plus the
[Lloyal Harness Builder Grant](https://github.com/lloyal-ai/hdk/blob/main/GRANT.md),
under which building, distributing, selling and hosting a harness or an
ability is always permitted and is never a Competing Use — including in
direct competition with Lloyal's own products.
