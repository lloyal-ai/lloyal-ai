# Working in __NAME__

This is a lloyal harness: one resident model, agents forked from its live state, signed abilities as sources,
three surfaces over one event stream. It is built on Effection's structured concurrency, and most of what a
coding agent gets wrong here comes from a prior carried in from somewhere else — request/response, async/await,
a view that owns state, a helper that already exists under another name. This file installs the right priors
and says where each thing already lives. Re-read it after any context compaction, before the next edit.

The README is the tour and stays the owner of the code map; `docs.lloyal.ai` owns the explanations. This file
is the contract.

## The model in six questions

Ask these of any code you read or write, from one tool call to the whole run
([thinking in lloyal](https://docs.lloyal.ai/thinking-in-lloyal)):

1. Who owns this work?
2. Which live state does it inherit?
3. What may enter or transform that state?
4. Who decides what happens next, and at which boundary?
5. What may become an accepted result or an external consequence?
6. What survives when the scope ends?

Three trees answer them, and they are not the same tree. **Ownership** (Effection scopes) decides what ends
together. **Inference** (trunk → spine → branches) decides what attention is shared and pruned. **Workflow**
(the orchestrator) decides what depends on what. The harness is a control loop over all three, acting at
explicit boundaries: orchestration, `AgentPolicy`, tools, the terminal, the commit.

Four lines carry it:

```ts
const value = yield* operation;                       // perform owned work here, under this owner
const task = yield* spawn(operation);                 // concurrent work that cannot outlive this scope
const findings = yield* withSpine(options, body);     // borrow live attention, return durable data, reclaim the subtree
yield* call(() => session.commitTurn(query, answer)); // cross a Promise boundary; make the result durable, explicitly
```

Data may leave a scope. Owned runtime state may not.

## Invariants

Each block is the contract for one part of the system. A change that breaks a line here is a design change,
and design changes are discussed before they are coded.

**Structured concurrency** ([Effection's contract](https://raw.githubusercontent.com/thefrontside/effection/v4/AGENTS.md) is normative; [the guides](https://frontside.com/effection) are the reasoning)
- A harness is a long-lived Effection scope. `function*` returning `Operation<T>` is the shape of every piece of it.
- Never convert an Operation into an `async` function. Never `await` inside a generator.
- Every `Operation` is yielded, spawned, joined (`all`, `race`), returned, or handed to an API that owns it. None floats.
- Cross into promises only at a leaf: `yield* until(promise)` for a promise you hold, `yield* call(fn)` for a function that makes one.
- Cleanup belongs to the owner: `ensure`, never `try/finally` with a `yield*` inside the `finally`.
- No `new Promise`, `.then`, `AbortController`, `setTimeout` or `void promise` inside a file that imports `effection`. Each is a dangling effect the runtime cannot see.
- A stop waits for native work to settle (`waitUntilSettled`) before releasing what it touched.

**Inference state**
- The rig is a simulation: one loop advances every agent a tick at a time. A tool result lands on that agent's own branch and it decodes on. Nothing here is "per request".
- There is one context. Every agent is a branch of it and leases cells from the same room; a pruned branch returns its cells mid-run ([continuous context](https://docs.lloyal.ai/continuous-context)).
- An Agent is not an Effection task; the pool advances it. A Branch or spine never outlives the scope that made it. Return findings from `withSpine`, never the spine.
- The trunk is written in one place, `src/harness/brief.ts`. A model proposal ≠ an accepted result ≠ a permitted action ≠ committed session state.

**Evidence and citation**
- The reranker is a relative scorer within one query: take the top K under a token budget, never an absolute threshold. It is the admission gate for context, not a truth oracle ([focal lens](https://docs.lloyal.ai/focal-lens)).
- A finding reaches the answer through the terminal tool (`citedReport` / `defineOutput` from `@lloyal-labs/rig`), which weaves sources at capture. That is the one citation mechanism. Do not add a second weave, and never let an agent appear as a source.
- Constrained output goes through the tool-call path: declare a schema on the terminal tool and let the framework produce the grammar and parse the call. Never hand-roll a grammar, a JSON extractor or a streaming parser.

**Services and abilities** ([services](https://docs.lloyal.ai/services) · [abilities](https://docs.lloyal.ai/abilities))
- A model is named once, as a block under `model:` in `harness.yml`. The block's presence is the request, its contents the selection; an absent block is a decision. Harness code reaches a bound service with `yield* service('reranker')` and nothing else. There is no fallback when it is unconfigured: the refusal names the block.
- An ability is a signed tarball in `vendor/`, listed in `src/app.ts`. It is never edited in place, never installed from npm, never reimplemented in the harness. Its tools join every inquiry's spine; the planner routes to it by name. A new capability is `npx lloyal-ai install <publisher>/<name>` or `npx lloyal-ai ability:new`.
- An ability's saved settings apply at its next take, under a live run, without a restart. Do not gate a settings save on run state.

**Media** ([document identity](docs/document-identity.md))
- Content is addressed by digest in the store under `media/` (an OCI image layout). An attachment enters once through ingress and is referenced by descriptor from then on. Bytes never ride the wire, the state or a prompt.
- A brief is one `docId` everywhere: state, `reports/<docId>/`, the KV ownership, the URL.

**Budgets and pressure** ([agent policy and context pressure](https://docs.lloyal.ai/agent-policy-and-context-pressure))
- Every limit is one row of `src/harness/budgets.ts`; `defaults.effort` picks the row. Add a number there or nowhere.
- Time and turns are per line of inquiry; the room is shared. The soft limit is where an agent is told to wind up, the hard limit where it is stopped and asked for what it has. Policy hooks (`shouldExit`, guards, recovery) are the place to steer, not a `while` loop around the pool.

**Configuration** ([harness.yml](https://docs.lloyal.ai/harness-yml))
- Everything configurable is declared once as data in `src/config.ts` with `defineConfig`, read through `ConfigOf`, and appears in the settings pane for free. Precedence is `cli > env > harness.json > harness.yml > default`.
- `harness.yml` is committed and yours to edit as text. `harness.json` is the runtime overlay and is written only by the platform's settings path. Harness code never writes either file. Secrets live in the environment or the settings pane, never in yml.
- A web visitor never mutates the harness: on the served target a save is session-scoped and nothing relaunches, fetches or persists on a visitor's command. Do not add a path that does.

**Prompts** ([prompts/README](src/harness/prompts/README.md))
- Every word the model hears in this app's voice is an Eta file in `src/harness/prompts/`, rendered by `prompt(name, input)` in `src/harness/prompts.ts`. No prompt is a string in code. A system file opens with the frame; every input is guarded; a missing input renders empty and is reported, never the word `undefined`.

**View**
- `src/ui/reduce.ts` is the one fold; every surface renders the same `AppState`. No view holds truth, calls the model or reads the wire directly: a view reaches the harness only through `HarnessProvider` and the hooks from `@lloyal-labs/ui`.
- Streaming text is a rendering cost with a rendering fix (split at the last blank line, memoize above, stream the tail). Never a lexer, a grammar or an AST for a rendering symptom.

## Before you change anything

- Read the owning file whole. The README's "Read it in this order" is the order.
- Say which of the six questions the change answers. If it answers none, it is probably a view or a prompt change.
- Find the existing construct first. The table below is the list; if the thing you are about to write has no name in it, it exists under a name you have not found, or it is a new concept, and new concepts are discussed before they are coded.
- Enumerate the dependents: the three targets, the reducer, the selectors, the scenario tests. Fix the boundary once, not the instance where it bit.
- Write the matrix before the code: templates × surfaces, every path × every failure. The tests in `test/invariants/` are laws; when you extend the harness, add the law you are promising.
- One thing per construct. A comment explaining a block is a function that is missing; extract and name it.

## Reach for what exists

| you want to | reach for | it lives in |
|---|---|---|
| run agents together, or one after another, over shared attention | `withSpine`, `agentPool`, `parallel` / `chain` / `dag` | `@lloyal-labs/lloyal-agents`, used in `src/harness/research.ts` |
| decide what an agent does next (exit, guard a call, retry, recover) | `AgentPolicy`, `policyFromBudget`, `ToolLifecycleHooks` | `@lloyal-labs/lloyal-agents`, wired where the pool is made in `src/harness/research.ts` |
| change a limit | the row in `budgets.ts` | `src/harness/budgets.ts` |
| a tool of your own | `Tool` with a JSON schema; add it where the stage's tools are listed | `src/harness/research.ts` |
| end a turn with a structured, cited result | `citedReport`, `defineOutput`, `RIG_REPORT` | `@lloyal-labs/rig` |
| classify or judge with the resident model | a one-task pool with `defineOutput`; rank with `service('reranker')` | README recipes |
| a second model (reranker, vision, embedding) | a `model.<name>` block in `harness.yml`; `service(name)` in code | `harness.yml`, `@lloyal-labs/rig` |
| a new source | `npx lloyal-ai install`, then the factory in `abilities` | `src/app.ts`, `vendor/` |
| what a reader can do, what a view is told | `Command`, `WorkflowEvent` | `src/protocol.ts` |
| handle a command | its group in the command loop, through `serveCommands` | `src/harness/brief.ts` |
| the current run: replace, stop, wait | `useExecution` (`run.replace`, accepted ≠ finished) | `@lloyal-labs/rig`, `src/harness/brief.ts` |
| a setting a reader can change live | a key in `defineConfig`; read it with `ConfigOf` | `src/config.ts` |
| an ability's setting under a run | the `set_ability_config` command; the ability reads it at its next take | `@lloyal-labs/rig` `settings` |
| the prompt a stage hears | its pair of `.eta` files, `prompt(name, input)` | `src/harness/prompts/`, `src/harness/prompts.ts` |
| what the app is for, in the model's hearing | `purpose` and `answers` | `src/harness/instructions.ts` |
| attach a file, show an image, cite a page | `Attachment`, `Descriptor`, `representationUrl`; `useAssets`, `Lightbox` | `@lloyal-labs/media`, `@lloyal-labs/ui` |
| keep or search settled briefs | the library and the corpus ability pointed at `reports/` | `src/harness/library.ts` |
| show something | a selector, then a moment | `src/ui/select/`, `src/ui/moments/` |
| the same view on cli, desktop and web | `HarnessProvider`, `useProjection`, `useSend`, `useAvailability`, `useRecover` | `@lloyal-labs/ui`, `targets/*` |
| render agent activity | `foldAgents` | `@lloyal-labs/ui/fold` |
| stream markdown without re-parsing | `splitStreaming`, the memoized `Prose` | `@lloyal-labs/ui/prose`, `src/ui/parts/Prose.tsx` |
| boot a surface | `bootEdge` (cli, desktop), `bootServed` (web); `createEngine`, `serveEngine`, `createWindow` | `@lloyal-labs/rig/node`, `@lloyal-labs/desktop`, `targets/*` |
| test a behaviour | `runHarness`, `stubReranker`, a scenario under `test/invariants/` | `@lloyal-labs/rig/testing`, `test/invariants/harness.ts` |
| see what a run did | `LLOYAL_DEV=1`, then the dev pane's timeline or the trace file | `@lloyal-labs/dev-tools` |

## The packages, and who may import what

The stack is layered: llama.cpp → liblloyal → lloyal.node → sdk → agents → rig → this harness. Each layer's
vocabulary is the one the layer above programs against. This harness imports `rig`, `lloyal-agents`, `media`,
`binding`, `ui`, `dev-tools`, `desktop` and its vendored abilities. From `sdk` it takes only the three
names the platform contract hands it, `SessionContext`, `Session` and `Branch`; it never calls an sdk
primitive beyond them, and never imports `lloyal.node`. A need that seems to require either belongs in a
rig or agents contract. A test reads the sdk mock only through `test/invariants/harness.ts`.

| package | what it is |
|---|---|
| `@lloyal-labs/lloyal-agents` | The agent runtime: `Agent`, `Tool`, `AgentPolicy`, the pool, `withSpine`, orchestrators, replay. Knows no tool but Delegate. |
| `@lloyal-labs/rig` | The app runtime: abilities and their registry, services, the terminal and plan tools, admission, config as data, the command loop, execution. Node-free at its root. |
| `@lloyal-labs/rig/node` | The same runtime where it touches the machine: the boots, models and slots, the config files, the media store, settings, the served host. |
| `@lloyal-labs/rig/testing` | `runHarness` over a scripted model, `stubReranker`, `stubEmbedder`. No weights. |
| `@lloyal-labs/media` | Content addressing: attachments, descriptors, the OCI store, image and PDF ingress (`/node`). |
| `@lloyal-labs/binding` | The headless interface: the event bus down, commands up, the projection a view folds. Transports in `/node` and `/web`. |
| `@lloyal-labs/ui` | The view side: `HarnessProvider` and hooks, the installer, the agent fold, prose and figure primitives. |
| `@lloyal-labs/dev-tools` | The developer's pane: timeline, sources, settings, over the same events. Present only under `LLOYAL_DEV=1`. |
| `@lloyal-labs/desktop` | The Electron main-process pieces: the engine over `bin/run.js`, the window, the content scheme. |
| `@lloyal-labs/host`, `@lloyal-labs/relay` | One resident model serving N sessions; the wss relay for remote frontends. Reached through `bootServed`. |
| `@lloyal-labs/sdk`, `@lloyal-labs/lloyal.node` | The inference primitives and the native binding beneath everything. Not a harness surface. |
| `@lloyal-labs/*-ability` | `web`, `corpus`, `documents`: signed sources in `vendor/`, declared in `src/app.ts`. |

## What proves what

- `npm test` runs `test/invariants/`: the real harness over a scripted model, no weights. It proves the wire, the laws and the prompts' shape. It cannot prove what the model will do.
- `node bin/run.js --query "…"` is a real run on the resident model. Only a real run proves behaviour, and it proves it for the code that ran: after an engine edit, restart the dev command before judging.
- A green typecheck proves what it covered. The engine is bundled once at `dev:*` start; prompts are read at every render; the view hot-reloads.
- `LLOYAL_DEV=1` writes the trace and mounts the dev pane; read the trace before explaining a run.
