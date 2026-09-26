# Working in __NAME__

This is a lloyal harness: one resident model, agents forked from its live state, a signed ability as its
source, three surfaces over one event stream. It is built on Effection's structured concurrency, and most of
what a coding agent gets wrong here comes from a prior carried in from somewhere else — request/response,
async/await, a view that owns state, a helper that already exists under another name. This file installs the
right priors and says where each thing already lives. Re-read it after any context compaction, before the
next edit.

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
- The trunk is written in one place, `src/harness/article.ts`. A model proposal ≠ an accepted result ≠ a permitted action ≠ committed session state.

**Evidence and citation**
- A finding reaches the answer through the terminal tool (`citedReport` / `defineOutput` from `@lloyal-labs/rig`), which weaves sources at capture. That is the one citation mechanism. Do not add a second weave, and never let an agent appear as a source.
- Constrained output goes through the tool-call path: declare a schema on the terminal tool (`defineOutput` with a zod shape, as `src/harness/classify.ts` does) and let the framework produce the grammar and parse the call. Never hand-roll a grammar, a JSON extractor or a streaming parser.
- A reranker, when you add one, is a relative scorer within one query: take the top K under a token budget, never an absolute threshold ([focal lens](https://docs.lloyal.ai/focal-lens)).

**Services and abilities** ([services](https://docs.lloyal.ai/services) · [abilities](https://docs.lloyal.ai/abilities))
- A model is named once, as a block under `model:` in `harness.yml`. The block's presence is the request, its contents the selection; an absent block is a decision. Harness code reaches a bound service with `yield* service('reranker')` and nothing else. There is no fallback when it is unconfigured: the refusal names the block.
- An ability is a signed tarball in `vendor/`, listed in `src/app.ts`. It is never edited in place, never installed from npm, never reimplemented in the harness. Its tools join every agent's spine. A new capability is `npx lloyal-ai install <publisher>/<name>` or `npx lloyal-ai ability:new`.
- An ability's saved settings apply at its next take, under a live run, without a restart. Do not gate a settings save on run state.

**Configuration** ([harness.yml](https://docs.lloyal.ai/harness-yml))
- Everything configurable is declared once as data in `src/config.ts` with `defineConfig`, read through `ConfigOf`, and appears in the settings pane for free. Precedence is `cli > env > harness.json > harness.yml > default`.
- `harness.yml` is committed and yours to edit as text. `harness.json` is the runtime overlay and is written only by the platform's settings path. Harness code never writes either file. Secrets live in the environment or the settings pane, never in yml.
- A web visitor never mutates the harness: on the served target a save is session-scoped and nothing relaunches, fetches or persists on a visitor's command. Do not add a path that does.

**Prompts** ([prompts/README](src/harness/prompts/README.md))
- Every word the model hears in this app's voice is an Eta file in `src/harness/prompts/`, rendered by `prompt(name, input)` in `src/harness/prompts.ts`. No prompt is a string in code. A system file opens with the frame; every input is guarded; a missing input renders empty and is reported, never the word `undefined`.

**View**
- `src/ui/state.ts` is the one fold; every surface renders the same `AppState`. No view holds truth, calls the model or reads the wire directly: a view reaches the harness only through `HarnessProvider` and the hooks from `@lloyal-labs/ui`.
- Streaming text is a rendering cost with a rendering fix (split at the last blank line, memoize above, stream the tail). Never a lexer, a grammar or an AST for a rendering symptom.

## Before you change anything

- Read the owning file whole. The README's "The shape" is the map.
- Say which of the six questions the change answers. If it answers none, it is probably a view or a prompt change.
- Find the existing construct first. The table below is the list; if the thing you are about to write has no name in it, it exists under a name you have not found, or it is a new concept, and new concepts are discussed before they are coded.
- Enumerate the dependents: the three targets, the fold, the scenario tests. Fix the boundary once, not the instance where it bit.
- Write the matrix before the code: every path × every failure. The tests in `test/invariants/` are laws; when you extend the harness, add the law you are promising.
- One thing per construct. A comment explaining a block is a function that is missing; extract and name it.

## Reach for what exists

| you want to | reach for | it lives in |
|---|---|---|
| run agents together, or one after another, over shared attention | `withSpine`, `agentPool`, `parallel` / `chain` | `@lloyal-labs/lloyal-agents`, used in `src/harness/wiki.ts` |
| decide what an agent does next (exit, guard a call, nudge, recover) | `AgentPolicy`, `DefaultAgentPolicy`, `ToolLifecycleHooks` | `@lloyal-labs/lloyal-agents`; `EVIDENCE_FIRST` and `NUDGE` in `src/harness/wiki.ts` |
| the angles an article is read from, its turn cap | `ANGLES`, `MAX_TURNS` | `src/harness/wiki.ts` |
| a tool of your own | `Tool` with a JSON schema; add it to the pool's tools beside the abilities' | README recipes, `src/harness/wiki.ts` |
| end a turn with a structured, cited result | `citedReport`, `defineOutput`, `RIG_REPORT` | `@lloyal-labs/rig` |
| classify with the resident model | a one-task pool over `defineOutput` | `src/harness/classify.ts` |
| a second model (reranker, vision, embedding) | a `model.<name>` block in `harness.yml`; `service(name)` in code | `harness.yml`, `@lloyal-labs/rig`, README recipes |
| a new source | `npx lloyal-ai install`, then the factory in `abilities` | `src/app.ts`, `vendor/` |
| what a reader can do, what a view is told | `Command`, `WorkflowEvent` | `src/protocol.ts` |
| handle a command | its group in the command loop, through `serveCommands` | `src/harness/article.ts` |
| the current run: replace, stop, wait | `useExecution` (`run.replace`, accepted ≠ finished) | `@lloyal-labs/rig`, `src/harness/article.ts` |
| a setting a reader can change live | a key in `defineConfig`; read it with `ConfigOf` | `src/config.ts` |
| the prompt a stage hears | its pair of `.eta` files, `prompt(name, input)` | `src/harness/prompts/`, `src/harness/prompts.ts` |
| what the app is for, in the model's hearing | `purpose` and `answers` | `src/harness/instructions.ts` |
| what is kept on disk, and read back | `articles`, `saved`, the record beside the markdown | `src/harness/article.ts` |
| show something | the fold, then the view | `src/ui/state.ts`, `src/ui/App.tsx`, `src/ui/cli.tsx` |
| the same view on cli, desktop and web | `HarnessProvider`, `useProjection`, `useSend`, `useAvailability`, `useRecover` | `@lloyal-labs/ui`, `targets/*` |
| render agent activity | `foldAgents` | `@lloyal-labs/ui/fold` |
| stream markdown without re-parsing | `splitStreaming` | `@lloyal-labs/ui/prose`, `src/ui/Markdown.tsx` |
| boot a surface | `bootEdge` (cli, desktop), `bootServed` (web); `createEngine`, `serveEngine`, `createWindow` | `@lloyal-labs/rig/node`, `@lloyal-labs/desktop`, `targets/*` |
| test a behaviour | `runHarness`, a scenario under `test/invariants/` | `@lloyal-labs/rig/testing`, `test/invariants/harness.ts` |
| see what a run did | `LLOYAL_DEV=1`, then the dev pane's timeline or the trace file | `@lloyal-labs/dev-tools` |

## The packages, and who may import what

The stack is layered: llama.cpp → liblloyal → lloyal.node → sdk → agents → rig → this harness. Each layer's
vocabulary is the one the layer above programs against. This harness imports `rig`, `lloyal-agents`,
`binding`, `ui`, `dev-tools`, `desktop` and its vendored ability. From `sdk` it takes only the three names
the platform contract hands it, `SessionContext`, `Session` and `Branch`; it never calls an sdk primitive
beyond them, and never imports `lloyal.node`. A need that seems to require either belongs in a rig or agents
contract. A test reads the sdk mock only through `test/invariants/harness.ts`.

| package | what it is |
|---|---|
| `@lloyal-labs/lloyal-agents` | The agent runtime: `Agent`, `Tool`, `AgentPolicy`, the pool, `withSpine`, orchestrators, replay. Knows no tool but Delegate. |
| `@lloyal-labs/rig` | The app runtime: abilities and their registry, services, the terminal tools, admission, config as data, the command loop, execution. Node-free at its root. |
| `@lloyal-labs/rig/node` | The same runtime where it touches the machine: the boots, models and slots, the config files, settings, the served host. |
| `@lloyal-labs/rig/testing` | `runHarness` over a scripted model, `stubReranker`, `stubEmbedder`. No weights. |
| `@lloyal-labs/media` | Content addressing: attachments, descriptors, the OCI store, image and PDF ingress (`/node`). Not used by this app until it takes attachments. |
| `@lloyal-labs/binding` | The headless interface: the event bus down, commands up, the projection a view folds. Transports in `/node` and `/web`. |
| `@lloyal-labs/ui` | The view side: `HarnessProvider` and hooks, the installer, the agent fold, prose primitives. |
| `@lloyal-labs/dev-tools` | The developer's pane: timeline, sources, settings, over the same events. Present only under `LLOYAL_DEV=1`. |
| `@lloyal-labs/desktop` | The Electron main-process pieces: the engine over `bin/run.js`, the window, the content scheme. |
| `@lloyal-labs/host`, `@lloyal-labs/relay` | One resident model serving N sessions; the wss relay for remote frontends. Reached through `bootServed`. |
| `@lloyal-labs/sdk`, `@lloyal-labs/lloyal.node` | The inference primitives and the native binding beneath everything. Not a harness surface. |
| `@lloyal-labs/wikipedia-ability` | The signed source in `vendor/`, declared in `src/app.ts`. |

## What proves what

- `npm test` runs `test/invariants/`: the real harness over a scripted model, no weights. It proves the wire, the laws and the prompts' shape. It cannot prove what the model will do.
- `node bin/run.js --query "…"` is a real run on the resident model. Only a real run proves behaviour, and it proves it for the code that ran: after an engine edit, restart the dev command before judging.
- A green typecheck proves what it covered. The engine is bundled once at `dev:*` start; prompts are read at every render; the view hot-reloads.
- `LLOYAL_DEV=1` writes the trace and mounts the dev pane; read the trace before explaining a run.
