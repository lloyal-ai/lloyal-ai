<div align="center">
  <br />
  <a href="https://lloyal.ai">
    <img src=".github/readme/lloyal-emblem.png" width="190" height="190" alt="Lloyal Labs [LL] emblem" />
  </a>
  <br />
</div>

<h1 align="center">Agents without an API</h1>

<p align="center">
  The complete intelligence runtime you can ship inside your app.
</p>

<p align="center">
  <a href="https://lloyal.ai">Website</a>
  &nbsp;·&nbsp;
  <a href="https://docs.lloyal.ai/build-your-first-harness">Quickstart</a>
  &nbsp;·&nbsp;
  <a href="https://apps.lloyal.ai/download/Fieldnote-latest-arm64.dmg" title="Download Fieldnote for macOS on Apple silicon">Demo (macOS)</a>
</p>

<br />

<p align="center">
  <a href="https://apps.lloyal.ai/#/app/Fieldnote">
    <img src=".github/readme/fieldnote-overview.png" width="100%" alt="Illustrated Fieldnote overview: a rooftop-solar investigation in front of branching agent timelines and the live inference inspector." />
  </a>
</p>

<p align="center">
  <sub>Fieldnote, built with Lloyal. Illustrated application and inference views.</sub>
</p>

<br />

## Program the model's working memory

Lloyal is an intelligence runtime for TypeScript applications. Your program and the model run in the same
process, so application code can hold handles to live inference state. The model's working memory becomes
something your application can program.

**An agent in Lloyal is a branch of the model's live state, not a request.** Fork a branch that has already
read the evidence and its children inherit that attention state. They continue independently from the same
starting point. If that lineage includes a projected image, each child inherits the attention state of that
same projection. The shared prefix does not need to be processed again.

That gives your application three capabilities:

- **Compose resident models.** Give a reasoning model retrieval, reranking, and vision through specialists
  that live alongside it. Your code and the model's tools can call those services during a task.
- **Control agents during inference.** Choose which state an agent inherits, what evidence enters its
  context, how work branches, and when it stops. Inspect the execution while it is happening.
- **Ship the whole application.** Use the same TypeScript harness in a desktop app, a CLI, or a web app
  served from your infrastructure. First launch provisions the models your application needs.

The [inference kernel](https://github.com/lloyal-ai/liblloyal) exposes the underlying fork, prune, merge,
and replay operations. [Continuous Context](https://docs.lloyal.ai/continuous-context) explains how that
state remains available to application code throughout a run.

## Get started

Start with a working deep-research application:

```sh
npx lloyal-ai new my-app --template research
cd my-app
npm run dev:desktop
```

Use **Node.js 24 or newer**. For the default models, **16 GB memory is recommended**; allow about **4.5 GB
for research model files**, plus project dependencies. See [system requirements](https://docs.lloyal.ai/system-requirements)
for supported platforms and GPU backends. Producing a signed desktop download currently requires macOS.

First launch downloads and verifies a 4B reasoning model, a 0.6B reranker, and the paired vision projector.
Subsequent launches use the installed weights. Inference requires no API key or separate model server.

Run `npx lloyal-ai new` without a name for the interactive model, template, and surface choices. The
[wiki template](templates/basic/README.md) provides a smaller starting point. Both generate application
source you can change and distribute.

[Build your first harness](https://docs.lloyal.ai/build-your-first-harness) ·
[Commercial-use permissions](#licence)

## How it works

### Compose resident models

Declare the models your application needs in `harness.yml`:

```yaml
model:
  llm:       { id: qwen3.5-4b }
  reranker:  { id: qwen3-reranker-0.6b-q8 }
  embedding: { id: nomic-embed-text-v1.5-q4 }
  vision:    {} # use the catalog's projector pairing for this reasoning model
```

The runtime acquires and binds them before the harness runs. A tool can recall candidate passages with an
embedding model, score them with the reranker, and return selected evidence to the reasoning model. The
reasoning model can invoke that tool as part of its own work. Vision projects an image or document page
into its attention when needed.

The reranker and embedding model have their own contexts. Shared attention belongs to agents forked from
the same reasoning-model lineage; it is not one context shared by every model in the application.

An [ability](https://docs.lloyal.ai/abilities) bundles tools, instructions, settings, and required services.
Deep-research includes web, document, and corpus abilities. You can install another or write your own tools
over local files, databases, and application state. [Services](https://docs.lloyal.ai/services) covers model
composition and access from both harness code and abilities.

### Fork agents from live state

Inside a running harness, pass a live branch that already holds the evidence to an operation like this:

```ts
import type { Branch } from "@lloyal-labs/sdk";
import { agentPool, parallel } from "@lloyal-labs/lloyal-agents";

export function* review(parent: Branch) {
  const pool = yield* agentPool({
    parent,
    acceptFreeText: true,
    budget: { maxTurns: 4 },
    orchestrate: parallel([
      { systemPrompt: "", content: "Check the technical assumptions." },
      { systemPrompt: "", content: "Identify contradictory evidence." },
    ]),
  });
  return pool.outcomes;
}
```

Both agents inherit the parent's processed context and add their own continuations. The runtime batches
active branches together; new continuations still consume memory and computation. Results return as data,
including whether each agent failed, so the harness can choose what to accept.

Use `parallel`, `chain`, `fanout`, or `dag`, or write a custom orchestrator. A tool can start a pool from the
calling agent's branch, allowing delegation during reasoning. Findings committed to a shared branch become
available to agents forked from it afterwards; existing siblings do not automatically share new findings.

The generator syntax uses [structured concurrency](https://docs.lloyal.ai/structured-concurrency):
`yield*` runs an operation whose lifetime belongs to its enclosing scope. Stopping that scope cleans up
the work it started. See [agents and orchestration](https://docs.lloyal.ai/agents) for complete examples.

## Inspect and intervene

DevTools exposes the execution behind the app:

- **Agent timelines:** follow branching work, tool calls, waiting, and completion; cancel an individual lane.
- **Epistemics:** inspect entropy and surprisal during generation. These are generation signals, not factual-confidence scores.
- **Context admission:** see retrieved candidates, reranking, and what each agent actually receives.
- **Live controls:** pause a run, change applicable settings, or ask it to finish with its current findings.

![A planner and two research agents sharing one model's attention state, with tool events and context usage visible](.github/readme/three-agents-one-model.jpg)

*A real run from the deep-research template: the planner finishes, then two researchers fork from a shared
prefix and search independently.*

The desktop and web development commands enable tracing. The same events feed the live pane and a
session JSONL file containing prompts, tool calls, results, and branch lifecycle events.
[Debug with traces](https://docs.lloyal.ai/traces) explains how to inspect the recording.
[The focal lens](https://docs.lloyal.ai/focal-lens) explains how the reranker's instruction governs evidence admission.

## Built with Lloyal

**Fieldnote** is a deep-research application with editable plans, parallel inquiries, PDFs, citations,
individual stops, and follow-ups that continue from warm context. Its research strategy is application
code you can replace. The same runtime can support a spreadsheet that enriches rows, document review,
or an assistant working with your application's own data and tools.

[Download for macOS (Apple silicon)](https://apps.lloyal.ai/download/Fieldnote-latest-arm64.dmg) ·
[Read its source](https://github.com/lloyal-ai/fieldnote) ·
[Explore the template walkthrough](guides/fieldnote-walkthrough.md)

## One application, three surfaces

The same harness runs across three interfaces. The application decides where inference lives:

| Surface | Development command | Where the model runs |
| --- | --- | --- |
| Desktop | `npm run dev:desktop` | In the app's engine process |
| CLI | `npm start` | In the terminal process |
| Web | `npm run dev:web` | On the host serving the browser |

For multiple web users, `npm run serve` starts the host. Sessions have independent contexts and agents over
shared model weights. The [serving guide](https://docs.lloyal.ai/serve) covers the browser client, capacity,
and deployment configuration.

### Ship a desktop download

From the project root, on macOS with signing credentials configured:

```sh
npx lloyal-ai ship --notarize
```

This builds a signed, notarized DMG carrying the application and runtime. Model weights are provisioned
and digest-verified on the user's first launch, rather than bundled into the download. The installer shows
progress for each model. [Shipping an app](https://docs.lloyal.ai/ship) covers signing and distribution;
[running and configuring](guides/running-and-configuring.md) covers model selection, abilities, and installation behavior.

## FAQ

<details>
<summary><strong>Does everything work offline?</strong></summary>

Inference and local document, image, and library operations work offline after the weights are installed.
Web search and tools that call external services need a connection. In a web deployment, the browser
connects to your host; the model runs there.

</details>

<details>
<summary><strong>Can I bring a different model?</strong></summary>

Yes. Select a catalog model or point the configuration at a compatible GGUF. Model architecture, available
memory, and projector compatibility still matter. A vision projector must match a supported multimodal
reasoning model. See [models](https://docs.lloyal.ai/models) and the
[model commands](guides/running-and-configuring.md#models).

</details>

<details>
<summary><strong>Where do I change the generated app?</strong></summary>

In the research template, `src/ui/presentation.ts` names the app, `src/harness/instructions.ts` defines its
purpose, `src/harness/research.ts` controls its investigation, and `src/harness/prompts/` holds the prompts.
These files are yours. The [customization guide](guides/fieldnote-walkthrough.md#make-it-yours-in-three-edits)
walks through them.

</details>

## Go deeper

- [Runtime recipes](guides/recipes.md): composition, typed decisions, focal lenses, steering, policy, and tools.
- [Thinking in Lloyal](https://docs.lloyal.ai/thinking-in-lloyal): execution state and ownership.
- [The HDK](https://github.com/lloyal-ai/hdk): TypeScript runtime packages.
- [liblloyal](https://github.com/lloyal-ai/liblloyal): native inference primitives and continuous tree batching.
- [Issues](https://github.com/lloyal-ai/lloyal-ai/issues): questions and bug reports.

## Licence

The CLI is [MIT](LICENSE). Generated application code is yours to license. Runtime packages have their own
license and the [Lloyal Harness Builder Grant](https://github.com/lloyal-ai/hdk/blob/main/GRANT.md), which
permits building, distributing, selling, and hosting applications and abilities. Model weights retain their
respective licenses.
