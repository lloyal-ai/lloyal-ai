# __NAME__

A vertical inference harness. The model lives *inside* the app — no API key, and nothing on the inference path touches the network.

## Run it

```sh
npm install
```

Then start a surface — each folds the same harness:

__RUN_STEPS__

The recommended model is fetched and **digest-verified** into `models/llm/` on first run — no key. (Prefer your own weight? Drop a `.gguf` in `models/llm/`, or point `model.llm.path` in `harness.yml` at one.) Type a question and watch two agents research it in parallel while a synth combines their notes.

The **web** surface is two processes — a resident-model **host** and a browser client; `npm run dev:web` starts both (the browser reconnects until the host is up). To run the host on its own (a remote box, or the browser elsewhere), use `npm run serve` + `npm run dev:web:client`. For a fast cli loop without a build step, use `npm run dev`.

## The shape

```
src/
  app.ts         what this app IS: its abilities, its config, its harness
  harness/
    harness.ts   ← the one file that's yours: your program, as code
    protocol.ts  the events (↓) and commands (↑) your harness speaks
  ui/
    state.ts     node-free reduce(events) → AppState (every view folds it)
    App.tsx      the React view (desktop + web)
    cli.tsx      the Ink view (terminal)
targets/
  <surface>/     one thin entry per surface — cli · desktop · web
                 each is one call to the boot that owns it
test/
  invariants/    the fold's behaviour, over the real reduce
models/
  llm/           the resident model (fetched on first run; gitignored)
vendor/          signed Abilities — Ed25519-verified tarballs, committed
harness.yml      targets + model
```

Everything under `targets/` is convention handled for you — the boot mounts a view over a binding; a view is a sink that folds `reduce`. The center — `src/harness/harness.ts` — is where you program what your intelligence does: which agents exist, how they collaborate, what they trust, when work is done. `basic` runs a `parallel` pool + synth; `chain` is a one-line swap.

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
the same bytes offline, with nothing on the install path reaching the network.

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
