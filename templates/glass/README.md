# __NAME__

A conversational application built with the public Lloyal HDK. Work takes the shape the request needs, within one continuous conversation.

## Development

Node 24 or newer is required.

```sh
npm ci
npm run dev:web
```

`npm run dev:desktop` opens the desktop target. `npm start -- --query "Your question"` runs the same harness in the terminal. Models and services are declared in `harness.yml`; the platform provisions them before use.

Auto composes work through typed decisions. Direct, Plan, Parallel, Chain and Graph provide explicit alternatives; abilities remain independent of the mode. Plans can be edited before approval, intermediate work appears in compact tabs, and accepted findings become a separate answer. Answers can include citations, comparison tables and interactive checklists.

The application includes document and page inspection, recorded dictation, history search, referenced follow-ups, pause/resume/finish/stop and durable conversation turns. Reopening reconstructs the trunk by prefill. Unfinished workers are transient. See [conversation ownership](docs/document-identity.md) and [verification](docs/verification.md) for precise guarantees and remaining release gates.

The [approved interactive reference](docs/design/reference.html) records the design direction and contains simulated outcomes. The application runs real models through the public HDK.

## Hosted web

Build the browser assets with `npm run build:web`, run `npm run serve`, then serve `dist-web/` and proxy the public host's socket and content routes. [Deployment instructions](docs/hosting.md) include a Caddy configuration. A local development browser uses `http://127.0.0.1:5173`.

The default manifest requests Qwen3.5-4B, its matching vision projector, Qwen3 reranking and Qwen3-ASR with its projector. First boot downloads and verifies declared artifacts into `models/`. The committed manifest does not pin one machine's GPU backend. Set machine-specific options through the supported configuration/CLI; do not replace a model with a different architecture and assume vision or speech still works.

## Desktop

`npm run dev:desktop` and `npm run build:desktop` use the same harness and views. The current public packaging command is `npx lloyal-ai@latest ship` on macOS; distribution signing and notarization require your credentials. A desktop build alone is not a signed-package verification.

## Code map

- `src/app.ts`: public rig composition and command serving.
- `src/harness/conversations.ts`: conversation, execution and trunk ownership.
- `src/harness/storage.ts`: versioned, atomic conversation records.
- `src/harness/direct.ts`: scoped answer operation.
- `src/domain/`: durable record schemas.
- `src/protocol.ts`: commands and observable facts.
- `src/ui/reduce.ts`: shared fold; `src/ui/parts/`: product views.
- `targets/`: thin CLI, web and desktop boots retained from the research scaffold.

One host process owns a conversation directory. Browser sessions share that directory and its history; do not expose a deployment as a private multi-tenant service. Model weights can be shared across sessions; conversation KV and active work remain session-scoped.

## Checks

```sh
npm run typecheck
npm test
npm run build:web
npm run build:desktop
```

[Verification matrix](docs/verification.md).
