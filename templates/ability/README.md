# __NAME__-ability

HDK ability scaffolded by `lloyal ability __NAME__`. Demonstrates the Ability protocol with a search + fetch tool pair. Out of the box the tools call Wikipedia's public REST so you can run + test the ability end-to-end before customizing — replace the tool bodies with your real __NAME__ integration.

## First run

```bash
npm install
npm run build
npm test    # writes to be added in test/
```

## File map

| File | What to edit |
|---|---|
| `ability.json` | `useWhen` (replace the `EDIT THIS` placeholder with a one-sentence description of when the planner should route to your ability). Tool names if you rename them. |
| `skill.eta` | The per-spawn skill template — describes how an agent should approach __NAME__ subtasks. |
| `src/source.ts` | The Source class. Add fields if your tools share state (e.g., a cached client). |
| `src/tools/search.ts` | Replace the Wikipedia opensearch call with your __NAME__ search backend. Keep the schema + return shape. |
| `src/tools/fetch.ts` | Replace the Wikipedia REST call with your __NAME__ detail fetch. Keep the schema + return shape. |
| `package.json` | Set `name` to your published npm package name (e.g., `@yourpublisher/__NAME__-ability`). |

## Protocol cheatsheet

- Tools subclass `Tool<TArgs>` from `@lloyal-labs/lloyal-agents`. The class properties `name`, `description`, `parameters`, and `protected` are read at registration time. The generator method `execute(args)` is the dispatch body; yield `call(asyncFn)` from `effection` for I/O.
- The Source subclass exposes `name` + `tools[]`. The framework registers each tool by its `name`.
- The factory (`create__NAME_PASCAL__App`) is a zero-arg generator that reads the manifest, constructs the source, and calls `defineAbility(...)`.

## Publishing

When the ability is ready to ship:

```bash
npm version 1.0.0      # or whatever version
lloyal publish    # submit to apps.lloyal.ai for review
```

See the [CLI publishing docs](https://docs.lloyal.ai/cli/publishing) for the full review flow.

## Licence

This project is yours — add whatever licence your organisation needs. The
scaffolding that produced it is MIT and imposes nothing on your code.

Your use of the HDK runtime (`@lloyal-labs/*`) is covered by the Functional
Source License plus the [Developer Grant](https://github.com/lloyal-ai/hdk/blob/main/GRANT.md),
under which building, distributing, selling and hosting a harness or an ability
is always permitted and is never a Competing Use — including in direct
competition with Lloyal's own products.
