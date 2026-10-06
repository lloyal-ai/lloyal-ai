# Running and configuring your application

[Back to the README](../README.md) · [CLI reference](cli.md)

## Deployment surfaces

The same `harness(ctx, events, commands)` runs unmodified in a terminal, a native window and a browser. One
fold of state, one binding each, no view holding truth.

| Surface | Run | The model runs in |
| --- | --- | --- |
| A native desktop app | `npm run dev:desktop` | an engine process the window talks to |
| A browser | `npm run dev:web` | a host you serve; browsers connect to it |
| Your terminal | `npm start` | the process itself |

`npx lloyal-ai new` with no name asks for the name, surfaces, model and template.

## Ship your app

`ship` produces a distributable macOS application: a `.dmg` carrying the engine, its dependencies
and its prompts, ready to install or attach to a release.

```sh
npx lloyal-ai ship        # from the project root: builds the desktop surface, then packages it
```

The first run records an application identifier in `harness.yml`; every run after it, and CI, reads
it from there. Each template ships a replaceable icon at `build/icon.icns`.

Model weights are not bundled. Your users meet
the same provisioning screen you did on your first `dev:desktop` run: one row per model named in
`harness.yml`, each fetched and digest-verified with the bytes, the rate and the time left, and a
weight they already have offered as an alternative to downloading it. Everything lands in the
application's own support directory, never beside your project, and every launch after that opens
at once. Change a model in `harness.yml` and a fresh installation provisions the new one; an
existing installation keeps the manifest it seeded on first launch, along with every edit its
reader has made to it since.

Without a flag the image is unsigned, which is fast and opens only on the machine that built it.
`ship --notarize` produces the distributable artifact: signed with your Developer ID under the
hardened runtime, notarized and stapled, so a Mac that downloads it accepts it. Nothing is signed
unless you ask, and a request that cannot be met is refused before the build rather than quietly
downgraded to something nobody can install.

Credentials are read from the environment and from `.env.local` in the project, which git already
ignores. You can ship from your laptop, and CI needs no file because a real environment variable
wins. Put a certificate already in your keychain and a stored `notarytool` profile there and it
holds no secrets at all; `ship --notarize` prints the block to paste when it cannot find them.
[Shipping an app](https://docs.lloyal.ai/ship) is the whole account: obtaining a Developer ID, the
three notary routes, and what actually proves an image will open on someone else's Mac. macOS
packaging is available today; Windows and Linux packaging are planned.

## Models

The catalogue, your pins and what is on disk, from the project's root:

```sh
npx lloyal-ai models:list                        # the catalogue, your pins, what is on disk
npx lloyal-ai models:use <id> [--role reranker]  # a catalogue model, fetched and verified on the next launch
npx lloyal-ai models:add <path.gguf> [--role reranker]  # a local weight you already have
```

The reasoning model is a dial. The same harness runs a 4B on a laptop and a frontier model on your own GPU host;
the program does not change. The default set runs on a 16 GB laptop.

On a machine with a supported NVIDIA GPU, `new` offers CUDA configuration and downloads a signed backend
pack when required. For a project you cloned, `npx lloyal-ai backends:install` provides that setup. See
[system requirements](https://docs.lloyal.ai/system-requirements) for platform support and backend selection.

## Abilities

An **Ability** is an installed capability: tools, the instructions to use them, configuration, and a declaration
of the models it cannot work without. It runs inside the harness and can work with the calling agent's live
context. The harness provides what an ability declares by naming the model in `harness.yml`; `install` tells you
when the project names none and offers to write the line. Deep-research ships with web, corpus and documents.

The README's [Turnkey abilities](../README.md#turnkey-abilities-you-can-install) section lists each ability,
its tools, template defaults, and the documents workflow from extracted PDF text to visual page inspection.

```sh
npx lloyal-ai install <publisher>/<name>   # verified and vendored into the project
npx lloyal-ai ability:new my-ability        # start one of your own
```

Every install is Ed25519-verified against a reviewed catalogue: what you install is what was reviewed. Point the
corpus at `reports` in `harness.yml` and the app reads what it has written.

## Requirements

Node.js 24 or newer. Web search and tools that call external services need the network. Local documents,
images, and the library work offline once the weights are on disk. Outside an interactive terminal,
run `npm install` in the project yourself.
Building a distributable application needs macOS.
