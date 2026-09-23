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

## What it does

A brief is the one thing this app makes, and it lives through four
moments. The same four words name them in the code.

**Ask.** One question, and two choices beside it. The *shape*: **Ask**
puts one agent over every source for a straight answer; **Survey** plans
independent lenses and runs them side by side; **Investigate** runs them
one after another, each reading what the last one found. The *depth*:
**Quick**, **Standard** or **Thorough** — two, four or six lines of
inquiry, with the turns and time to match (every number is in
`src/harness/budgets.ts`). The chips under the composer switch a source
off for this question; attach a photo or a PDF by dropping it on.

**Frame.** When more than one source takes part, each is first asked what
it holds on the question; then the outline drafts itself line by line
from the planner's own stream. The outline IS the plan: rewrite a line,
strike one, add one, reorder them, switch the shape — and only then say
yes. If
the question is genuinely ambiguous, the planner asks first, and your
answer joins the conversation it plans from.

**Write.** Each line of the outline becomes a section, filled in place by
its own agent: searching, reading, waiting honestly through a rate limit,
writing its findings with their citations inline. Open any section's
inquiry to watch it think, step by step. **Hold** pauses the run with
everything in place; **Close the brief** settles with what it has; a
single line can be dropped from its row. A line that runs out of time or
room is asked for what it found rather than abandoned. Then one agent
reads every section and writes the brief in one voice (a plan of one line
is its own answer).

**Settle.** The document takes the room: the brief, a chip on every
citation, a sources grid the chips resolve into, margin marks for the
facts of the run (closed early, rests on one source, a line that did not
settle), and **How it got here** for the deliberation behind it. Ask a
follow-up and it is answered beneath the brief, from a context that
already holds the brief and everything asked of it so far. When the
sources turn up nothing, the brief says so where the answer would be, and
nothing is kept or invented.

Every settled brief joins the library in the sidebar — see "Memory".

## The media store

Everything you attach lives in `media/` at the project root: a
content-addressed store in the **OCI Image Layout**, the format a
container registry uses. Every blob is named by the `sha256:` digest of
its bytes, so an asset's identity IS its content — the same bytes are
stored once, and a citation that names a digest can only ever mean them. The store is the project's, not a brief's: it outlives every
session, a reopened brief finds its pictures and documents there again,
and because it is a published layout, anything that reads OCI can read it.
It sits beside `models/` and apart from `reports/`, because it is what the
app was given, not what it wrote.

### Attach something

Drop a photo or a PDF on the composer and ask about it. What happens next
is the part worth understanding, because **a picture and a document are
not treated the same way, and neither one rides the event wire.**

**Bytes go to the store, not to the model.** An attachment is posted to
the content plane, which sniffs its type, normalises an image or reads a
PDF into pages, and commits the bytes to `media/`. Nothing after that
moment moves bytes: commands, events and the library all carry the
digest.

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
`src/harness/budgets.ts`; the minutes the pickers quote are learned from
what YOUR machine actually does.

## Memory: every brief is ground for the next

Every settled brief is a folder under `reports/`, named by its id:

```
reports/<docId>/
  report.json     the record: the question, the shape and depth that wrote it,
                  the media it carried, the answer, what every inquiry found
  report.md       the brief as a reader opens it, with its annexure index
  annexure-N.md   one per line of inquiry that found something, sources included
  exchange-N.json each follow-up's own record, and its exchange-N.md beside it
```

The record is what the app reads back — the sidebar, a reopen, library
search — and it is written last, so a folder without one never settled.
The markdown is for you, and for the corpus.

**Semantic recall.** Point the corpus ability at that same directory and
the app reads what it has written. The corpus ships installed but off,
because it needs a path before it can run: uncomment
`abilities.corpus.corpusPath: reports` in `harness.yml`, or set it from
the corpus chip's settings in the composer. Then:

1. A brief settles → its folder lands in `reports/` → the corpus
   re-indexes.
2. The next question's recon probes the corpus and finds it; the planner
   routes tasks at past briefs *by name*; agents search and read them
   like any source; the new brief cites the old one.
3. Searching the sidebar ranks the library against your words with the
   same reranker the agents use.
4. Clicking a report in the sidebar RESTORES it as the session document —
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
2. `src/protocol.ts` — everything a reader can do (`Command`) and
   everything a view is told (`WorkflowEvent`). The table of contents.
3. `src/harness/brief.ts` — what happens when the reader does each thing.
   Its handlers come first, grouped by moment; how each is done is below
   them. This is where you see why a Stop is always heard, and why an
   attached image costs one projection however many agents look at it.
4. `src/harness/research.ts` — what the model does: `plan`, `write`,
   `answer`. `inquire` is the whole strategy — side by side or one after
   another — in one expression, and every stage can be replaced alone.
5. `src/ui/reduce.ts`, then `src/ui/select.ts`, then `src/ui/moments/` —
   events become one state, state becomes the brief's language, language
   becomes four components. No view holds truth, which is why the
   terminal, the window and the browser cannot disagree.
6. `src/harness/library.ts` — what is kept, and how every settled brief
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

Folders are roles; the files inside them are your domain.

```
src/
  app.ts               the app: what is installed, the parts, the loop
  config.ts            what can be configured, declared once as data
  protocol.ts          everything it says (↓) and hears (↑)
  harness/             ← your program
    research.ts        what the MODEL does: plan · write · answer, and the stages of write
    brief.ts           a brief's life; the only place the trunk is written
    library.ts         settled briefs on disk
    instructions.ts    what this app is for, in the model's hearing
    budgets.ts         every number it obeys, effort as the one knob
    prompts.ts         renders the prompt files; ~30 lines
    prompts/           every prompt, one Eta file per text — see "The prompts are files"
  ui/                  ← your view
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

**Seeing an edit take effect.** Three kinds of file reload differently.
The view (`src/ui/`) hot-reloads under `npm run dev:web` and
`npm run dev:desktop`. The prompts (`src/harness/prompts/`) are read
when a prompt is rendered, so an edit is live at the next question. The
engine — `src/app.ts` and `src/harness/`, the instructions
included — is bundled once when the dev command starts, so
after editing it, stop the dev command, start it again, and ask a fresh
question.

Ordered by ambition — each step is one file:

1. **What it is for** — `src/harness/instructions.ts` holds two sentences
   of yours: who the app works for, and what every answer must do. They are
   said on every path an answer can take — a direct question, a follow-up,
   a planned investigation — so this is the one edit that makes it your app.
2. **What it is called** — `src/ui/presentation.ts`, read by every surface.
3. **A prompt** — the files in `src/harness/prompts/` are yours to edit,
   and an edit is live at the next question. Their worked examples
   (immunotherapy trials, voice-agent latency) come from the domains this
   pipeline was tuned on: replace them with examples from yours first.
   What each file is, and what it is handed, is the next section.
4. **A number** — `src/harness/budgets.ts` holds every limit the writing
   obeys, with effort as the single knob each row fans out from.
5. **The register** — `src/ui/theme.ts` is the whole look as data.
6. **A derivation** — `src/ui/select.ts` is where machinery becomes
   language ("Searched — 8 results · en.wikipedia.org"). Add a selector,
   render it in a moment.
7. **A moment** — `moments/` and `parts/` are plain React over the fold.
   The terminal view folds the same state.
8. **The algorithm** — `src/harness/research.ts` owns what the
   intelligence does, written in the framework's grammar: a spine to fork
   from, a pool that runs agents together, a terminal that ends a turn, a
   settling pass. Hand `app.ts` a different one and everything else stands.
9. **A source** — `npx lloyal-ai install <publisher>/<name>`, then add
   its factory to `abilities` in `src/app.ts`. Which ones ship, and what
   installing does, is under "The sources are installed".

## The prompts are files

Everything the model is told in this app's own words is in
`src/harness/prompts/`, one Eta file per text. A stage is a pair —
`plan.system.eta` beside `plan.user.eta` — and the app renders both with
the same input. A single file is a single turn (`clarify.eta`). Two files
are partials every prompt shares: `framed.eta`, the frame, and
`cite.eta`, the citation rule.

**The frame.** Every system file opens with one line:

```
<% layout("./framed", { writesTheAnswer: true }) %>
```

That line is what carries your `src/harness/instructions.ts` into every
stage: the frame says your `purpose` first, then the file's own text,
and — only where `writesTheAnswer` is true — your `answers` last. The
planner never hears `answers` (its output is a plan); a lone inquiry, the
settling pass and a direct answer do. A test holds that no system file
ships without the frame.

**What a template is handed.** `it` is the input, and each value has one
owner — the app, the framework, or the tool whose grammar it belongs to:

| stage | `it.*` | who supplies it |
| --- | --- | --- |
| every system file | `purpose`, `answers` | `instructions.ts` — yours |
| `plan`, `plan-flat` | `query`, `count`, `routingKey`, `context` | the planner (rig): the question, how many tasks its grammar allows, the key a task's source is written under, and any clarification text (the shipped templates leave it unused — the round is on the trunk) |
| | `date`, `sources[{name, useWhen, toc}]`, `coverage` | this app, in `research.ts`: the day, each source the plan may route to, what the probes found each covers |
| `preflight` | `query`, `ability` | the coverage probe (rig), one per source |
| `inquiry` | `preamble`, `tool`, `takesSources`, `writesTheAnswer` | this app: the source's own preamble, the report tool's name, whether it takes `sources`, whether this inquiry is the answer |
| `recovery`, `preflight-recover` | `budget` | the framework, when it cuts an agent short: the words it may still write |
| `synthesize`, `synthesize-flat` | `query`, `findings[{task, body}]` | this app: the question, and the findings the spine does not already hold |
| `clarify` | `questions` | the planner's questions, said as the assistant's turn |

Eta here is three things: `<%= it.query %>` prints a value, `<% … %>`
runs plain JavaScript (an `if`, a `forEach`), and `<%~ include("./cite") %>`
inlines a partial. One rule of thumb: a line break right after a tag is
eaten, so a blank line after a tag is the newline that stands.

**Edit one.** Change any `.eta` and ask the next question — the folder is
read when the prompt is rendered.

**Add one.** A new stage is three steps. Write the pair of files, the
system one opening with the frame. Render them where the stage runs:
`prompt("my-stage", { query, … })` in `src/harness/research.ts` returns
`{ systemPrompt, content }`, ready to hand to an agent. Whatever the stage
knows goes in that object — a template sees exactly what you pass and
nothing else. `npm test` runs `test/invariants/prompts.test.ts`, which
refuses a system file that forgot the frame.

## The sources are installed

An **Ability** is a signed package: tools, the instructions to use them,
its configuration, and any model it needs. Three ship with this app, and
`src/app.ts` is the list:

```ts
export const abilities = [createCorpusAbility, createWebAbility, createDocumentsAbility];
```

`web` searches and reads pages (keyed with `TAVILY_API_KEY` in the
environment; keyless without). `documents` searches, reads and looks at
the PDFs you attach. `corpus` searches a folder of markdown, and ships
off until you give it a path — `abilities.corpus.corpusPath: reports` in
`harness.yml` turns the library into memory. The composer's chips switch
a source off for one question; a source's tools join every inquiry's
spine, and the planner routes tasks to it by name.

**Install one:** `npx lloyal-ai install <publisher>/<name>` verifies the
package against the catalogue, vendors its tarball into `vendor/`, and
you add its factory to the list above. **Write one:**
`npx lloyal-ai ability:new my-ability` starts one of your own.

**Abilities never come from npm.** They are distributed through the signed
channel, so `install` fetches the tarball, checks its Ed25519 signature
against the trust roots shipped with the framework, writes it to
`vendor/<publisher>__<name>-<version>.tgz` beside the signed manifest it
was checked against, and only then points
`package.json` at those exact bytes:

```json
"@lloyal-labs/web-ability": "file:vendor/lloyal__web-2.0.3.tgz"
```

That `file:` line is the whole reason an Ability appears in `package.json`
at all — it is how npm is told to materialise bytes the CLI has already
verified, never an instruction to fetch anything. Commit `vendor/` and
`npm ci` reproduces those exact bytes from the repo — the Ability is the
one dependency that never reaches the network, whatever else the install
resolves from the registry.

Two consequences worth knowing. The version is pinned to a file, so
upgrading is another `install`, not a range that drifts. And `lloyal new`
records what it installed under `harnessdev.abilities` in `package.json`
— that list is what the launcher reads back to name the exact
`install` commands when a clone is missing an Ability its code imports.

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
