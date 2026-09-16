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

> **Lineage.** Ships as **Fieldnote** — the sidebar mark and the window
> title. Rename those freely, but leave the `fieldnote.*` keys a browser
> stores under: they hold a reader's open panel and their pacing, and a
> rename forgets both. Evolved from reasoning.run 0.8.0's RACE/DRB-tuned
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

Fixtures to try it with are committed: `fixtures/paper.pdf` and four
figures, `figure-A` through `figure-D`.

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
answer) plus one annexure per inquiry, references included. The corpus
ability points at that same directory, so the system reads what it has
written:

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

## The shape

Four things under `src/`. Everything else is the platform's.

```
src/
  app.ts               what is installed, and how the parts are put together
  brief/               what a brief is: asked · framed · written · settled
    brief.ts           its life; the only place the trunk is written
    library.ts         settled briefs on disk, and the run record
    protocol.ts        the events (↓) and commands (↑) this harness speaks
  research/            how a brief is researched
    research.ts        the algorithm, in the framework's own grammar
    budgets.ts         every number it obeys, effort as the one knob
    prompts/           the seven tuned .eta prompts
  ui/                  what it looks like
    App.tsx            thin: the moment table and the dev pane mount
    select.ts          THE seam: AppState → the brief's language
    state.ts           AppState, the ONE fold every surface shares
    reduce.ts          reduce(state, event) → AppState
    theme.ts           the visual register as data: palette, type, motion
    moments/           one component per moment: Ask · Frame · Write · Settle
    parts/             the grammar: Shell, Composer, Library, InquiryRow,
                       OutlineRail, Prose, Figures, Sources
targets/               boot entries only — the platform owns what is below
  cli/ · web/ · desktop/
test/invariants/       the laws
fixtures/              a PDF and four figures, for the multimodal path
media/                 the content-addressed store (OCI Image Layout)
models/                resident weights (fetched on first run; gitignored)
vendor/                signed Abilities — Ed25519-verified tarballs, committed
reports/               your settled briefs — the library AND the memory
harness.yml            models, output dir, ability config, gate scope
```

## Where to begin

Ordered by ambition — each step is one file:

1. **A prompt** — the seven in `src/research/prompts/` are yours to edit.
2. **A number** — `src/research/budgets.ts` holds every limit the writing
   obeys, with effort as the single knob each row fans out from.
3. **The register** — `src/ui/theme.ts` is the whole look as data.
4. **A derivation** — `src/ui/select.ts` is where machinery becomes
   language ("Searched — 8 results · en.wikipedia.org"). Add a selector,
   render it in a moment.
5. **A moment** — `moments/` and `parts/` are plain React over the fold.
   The terminal view folds the same state.
6. **The algorithm** — `src/research/research.ts` owns what the
   intelligence does, written in the framework's grammar: a spine to fork
   from, a pool that runs agents together, a terminal that ends a turn, a
   settling pass. Hand `app.ts` a different one and everything else stands.
7. **A capability** — `npx lloyal-ai install <publisher>/<name>`, then add
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
