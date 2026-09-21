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

## What it keeps, and what it does not

A settled article is written to `sources.outputDir`: `article.md` first, then a small `article.json` record — and the record's existence is what makes the folder an article, so a crash midway leaves nothing half-kept. Past articles appear on the landing, grouped by topic: the list paints immediately and rearranges when the resident model answers, because nothing on screen waits for a model call.

Two limits worth knowing before you meet them:

- **Reopening an article does not resume it.** A follow-up deepens the article only while the session still holds it in memory; putting a saved one back on the trunk is state reconstruction, which is a different thing from keeping a file.
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
