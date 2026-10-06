# CLI reference

[Back to Get started](../README.md#get-started) · [Running and configuring](running-and-configuring.md)

The npm package is `lloyal-ai`; its executable is `lloyal`. Use Node.js 24 or newer.

```sh
npx lloyal-ai <command> [arguments] [options]
```

Alternatively, install with `npm install -g lloyal-ai` and use `lloyal <command>`. The examples below use
`npx`. Angle brackets mark required values; square brackets mark optional values. Replace placeholders
with your own values and omit the brackets.

## Command index

| Area | Commands |
| --- | --- |
| Create an application | [`new`](#new) |
| Manage models | [`models:list`](#modelslist), [`models:use`](#modelsuse), [`models:add`](#modelsadd), [`models:download`](#modelsdownload) |
| Deployment surfaces | [`targets:list`](#targetslist), [`targets:add`](#targetsadd), [`targets:remove`](#targetsremove) |
| Provision a backend | [`backends:install`](#backendsinstall) |
| Package an application | [`ship`](#ship) |
| Use and create abilities | [`install`](#install), [`ability:new`](#abilitynew) |
| Publish abilities | [`publishers register`](#publishers-register), [`publishers me`](#publishers-me), [`publish`](#publish), [`publish status`](#publish-status) |
| Contribute to the platform | [`link-local`](#link-local), [`unlink-local`](#unlink-local) |
| Internal channel review | [`review list`](#review-list), [`review inspect`](#review-inspect), [`review approve`](#review-approve), [`review reject`](#review-reject) |

## Help and version

| Invocation | Result |
| --- | --- |
| `npx lloyal-ai`, `npx lloyal-ai help`, `npx lloyal-ai --help`, `npx lloyal-ai -h` | Show global usage |
| `npx lloyal-ai --version`, `npx lloyal-ai -v` | Print the CLI version |
| `npx lloyal-ai <command> --help` | Show that command's usage; `-h` also works |

Nested commands also accept help, for example `npx lloyal-ai publish status --help`. The `publishers` and
`review` groups show their usage when called without a subcommand. An unknown command returns an error.
`--version` and `-v` are global options; other options belong after the command they configure.

## Project context

Run `models:*`, `targets:*`, `backends:install`, and `ship` in the project root containing `harness.yml`.
Run `install` in the application project that should receive the ability. These commands use the current
directory; they do not search parent directories for a project.

`new` and `ability:new` create a directory beneath the current directory, or beneath their `--dir` value.
`publish` operates on an ability project. Publisher and review commands operate on the channel.

## new

```sh
npx lloyal-ai new [name] [options]
```

Create an application from the wiki (`basic`) or deep-research (`research`) template. With no name, the
wizard runs when both stdin and stdout are terminals. Provided flags prefill its choices. A name,
`--yes`, or redirected input/output selects the flags path; that path requires a name.

| Argument or option | Meaning and default |
| --- | --- |
| `[name]` | Project and directory name. Required outside the wizard. Matches `[a-z][a-z0-9_-]{1,63}`. |
| `--template <basic\|research>` | Starting template. Default on the flags path: `basic`. |
| `--targets <list>` | Comma-separated `cli`, `desktop`, `web`. Default: all three. `cli` is always retained. |
| `--model <id\|path>` | Reasoning model catalogue ID or local GGUF path. Default: the catalogue's first reasoning model, currently `qwen3.5-4b`. |
| `--dir <path>` | Parent directory. Default: current directory. |
| `--backend-pack <download\|skip>` | Select the NVIDIA setup path. `download` authorizes provisioning and requests dependency installation even outside a terminal; `skip` skips that GPU setup. Without a flag, the detected GPU and wizard/confirmation determine the choice. |
| `--skip-install` | Skip automatic `npm install`, including when `--backend-pack download` was supplied. |
| `--skip-abilities` | Skip fetching the template's default abilities. Their imports remain in the scaffold; install the missing abilities before building or running it. |
| `-y`, `--yes` | Skip the wizard and accept defaults for unspecified choices, including NVIDIA provisioning when applicable. Does not by itself request `npm install` in CI. |
| `-h`, `--help` | Show help. |

The destination must not already exist. The CLI writes the selected model, prunes unselected surfaces,
and downloads and verifies the template's default abilities. Research includes Web, Corpus, and Documents;
Wiki includes Wikipedia. Model weights are provisioned on the application's first launch.

Automatic dependency installation normally runs when stdout is a terminal. In CI, run `npm install`
yourself unless you explicitly requested it through `--backend-pack download`. Default abilities are
still fetched with `--skip-install` and in CI; only `--skip-abilities` suppresses that step. An ability
that could not be fetched or whose service requirements are unmet is reported as pending.

```sh
npx lloyal-ai new
npx lloyal-ai new my-app --template research
npx lloyal-ai new my-app --template research --targets cli,web --model qwen3.5-4b --yes
```

For CI with a separate dependency step:

```sh
npx lloyal-ai new my-app --template research --yes --skip-install
npm --prefix my-app install
```

## models:list

```sh
npx lloyal-ai models:list
```

List catalogue IDs, active model selections, and GGUF files under `models/<role>/`. Active selections
include local `harness.json` overrides over `harness.yml`. No arguments or options beyond `-h`/`--help`.

## models:use

```sh
npx lloyal-ai models:use <id> [--role <role>]
```

Write a catalogue ID to `model.<role>.id` in `harness.yml`. The runtime downloads and verifies it on the
next run. An existing `path` selection for that role is replaced.

| Argument or option | Meaning and default |
| --- | --- |
| `<id>` | Catalogue model ID. Use `models:list` to see known IDs. |
| `--role <role>` | `llm`, `reranker`, `vision`, or `embedding`. Default: `llm`. |
| `-h`, `--help` | Show help. |

An unknown ID is written with a warning; it must resolve in the runtime's catalogue when provisioned.

```sh
npx lloyal-ai models:use qwen3-reranker-0.6b-q8 --role reranker
```

## models:add

```sh
npx lloyal-ai models:add <path> [--role <role>]
```

Write a local GGUF path to `model.<role>.path`, replacing an existing catalogue ID for that role. This
references the file in place. Relative paths resolve from the project root.

| Argument or option | Meaning and default |
| --- | --- |
| `<path>` | Local GGUF path. A missing file produces a warning; it must exist when the app loads it. |
| `--role <role>` | `llm`, `reranker`, `vision`, or `embedding`. Default: `llm`. |
| `-h`, `--help` | Show help. |

Local files are trusted by possession and are not checked against catalogue digests.

```sh
npx lloyal-ai models:add ./models/my-model.gguf
```

## models:download

```sh
npx lloyal-ai models:download <url> [--role <role>] [--sha256 <hex>]
```

Stream a weight to `models/<role>/<filename>.gguf` and select that local path in `harness.yml` after a
successful download. The filename comes from the URL path, without its query string.

| Argument or option | Meaning and default |
| --- | --- |
| `<url>` | Model download URL. |
| `--role <role>` | `llm`, `reranker`, `vision`, or `embedding`. Default: `llm`. |
| `--sha256 <hex>` | Expected SHA-256 digest. If supplied, a mismatch removes the downloaded file and returns an error. Without it, the download is trusted by source. |
| `-h`, `--help` | Show help. |

```sh
npx lloyal-ai models:download <model-url> --role llm --sha256 <expected-digest>
```

## targets:list

```sh
npx lloyal-ai targets:list
```

Show the template and which of `cli`, `desktop`, and `web` are present. No arguments or options beyond
`-h`/`--help`.

## targets:add

```sh
npx lloyal-ai targets:add <desktop|web>
```

Restore a deployment surface from the template recorded in `package.json`'s `harnessdev.template`
marker. The command updates the surface files and build configuration. Run `npm install` afterward to
materialize its dependencies. `cli` is required and cannot be added or removed.

The surface is the only positional argument. The only options are `-h`/`--help`.

```sh
npx lloyal-ai targets:add desktop
```

## targets:remove

```sh
npx lloyal-ai targets:remove <desktop|web> [--yes]
```

Delete the selected surface's generated source and its scripts, dependencies, and TypeScript entries.
`cli` is required and cannot be removed.

| Argument or option | Meaning and default |
| --- | --- |
| `<desktop\|web>` | Surface to remove. |
| `-y`, `--yes` | Confirm deletion without a prompt. Required when stdin is not a terminal. |
| `-h`, `--help` | Show help. |

```sh
npx lloyal-ai targets:remove web --yes
```

## backends:install

```sh
npx lloyal-ai backends:install [--yes]
```

Probe the GPU, driver, and CUDA runtime through the project's installed native runtime. On supported
Linux x64 NVIDIA machines, provision the signed backend pack and CUDA runtime when needed; use the npm
backend directly when it already supports the GPU. Successful setup writes `model.llm.gpu: cuda`.
Platforms without a published pack print a message and continue using their npm packages.

| Option | Meaning and default |
| --- | --- |
| `-y`, `--yes` | Authorize a required download without prompting. Supply it in CI when provisioning is needed. |
| `-h`, `--help` | Show help. |

Packs are cached under `~/.cache/lloyal/backends/` by native-runtime version and reused by applications on
the same version. A required download without `--yes` prompts in a terminal and errors in a non-terminal.

## ship

```sh
npx lloyal-ai ship [--notarize]
```

Build and package the desktop surface as a macOS DMG in `release/`. Requires macOS and a desktop surface.
Model weights are provisioned on the installed application's first launch.

| Option | Meaning and default |
| --- | --- |
| `--notarize` | Sign with Developer ID, notarize, and staple the ticket. Default: an unsigned local build. |
| `-h`, `--help` | Show help. |

The first interactive run asks for a bundle identifier and icon, then records them under `ship` in
`harness.yml`. In CI, configure `ship.id` beforehand; `ship.icon` can name an `.icns` or a square PNG of
at least 512 pixels. The template supplies `build/icon.icns`.

Signing configuration is read from the environment and the project's `.env.local`, with environment
variables taking precedence:

| Configuration | Values |
| --- | --- |
| Signing certificate | A Developer ID Application identity in the keychain, optionally selected with `CSC_NAME`, or `CSC_LINK` and `CSC_KEY_PASSWORD` for a base64 `.p12` and its password |
| Notarization with an API key | `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Notarization with an Apple ID | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Notarization with a stored profile | `APPLE_KEYCHAIN_PROFILE`, optionally `APPLE_KEYCHAIN` to select a keychain |

Choose a notarization credential route. An unmet notarization request fails before building rather than
silently producing an unsigned artifact. [Shipping documentation](https://docs.lloyal.ai/ship) covers the
credential setup and distribution checks.

## install

```sh
npx lloyal-ai install <publisher>/<name>[@<semver>] [--allow-scripts]
```

Resolve an ability from the signed channel, verify the catalogue and bundle, and install it into the
current application. The package is vendored under `vendor/` and recorded as a local `file:` dependency.

| Argument or option | Meaning and default |
| --- | --- |
| `<publisher>/<name>[@<semver>]` | Ability name and optional exact version, `^` range, `~` range, or `*`. Selects the highest matching channel version. Without a version, selects the highest available version. |
| `--allow-scripts` | Allow npm lifecycle scripts for this installation. Default: `npm install --ignore-scripts`. |
| `-h`, `--help` | Show help. |

```sh
npx lloyal-ai install lloyal/web
npx lloyal-ai install lloyal/corpus@2.1.0
```

Version selection uses the CLI's supported range forms above. Comparators such as `>=2.0.0` are not
supported. An omitted version or `*` can select a prerelease; pin an exact version for reproducibility.

The command checks model-service requirements before vendoring. In a terminal it can offer to write
missing service configuration to `harness.yml`; in CI those requirements must already be met. It then
runs npm and audits the installed dependency. A package lock is required.

Register a newly added ability's factory in `src/app.ts`'s `abilities` export and configure its settings.
Template defaults are already registered. Commit `vendor/`, `package.json`, and the lockfile so subsequent
npm installs use the verified local bundle. See [Turnkey abilities](../README.md#turnkey-abilities-you-can-install).

## ability:new

```sh
npx lloyal-ai ability:new <name> [--dir <path>] [--publisher <handle>]
```

Create an ability project with a manifest, instructions, and working Wikipedia search/fetch tool examples
to replace with your own backend. Dependency installation and building are separate steps.

| Argument or option | Meaning and default |
| --- | --- |
| `<name>` | Ability and directory name, matching `[a-z][a-z0-9_-]{1,63}`. |
| `--dir <path>` | Parent directory. Default: current directory. |
| `--publisher <handle>` | Publisher used to seed the npm package name. Default: `your-handle`. A leading `@` is removed; the remaining handle uses the same naming grammar. |
| `-h`, `--help` | Show help. |

```sh
npx lloyal-ai ability:new case-files --publisher acme
```

## Publisher authentication

Register a publisher interactively before publishing. Subsequent publishing and status commands use
Cloudflare Access browser sign-in or the `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` service-token
environment variables for an already registered identity. Publishing from CI requires those variables.
Interactive credentials are cached at `$XDG_CACHE_HOME/lloyal/auth.json`, defaulting to
`~/.cache/lloyal/auth.json`.

## publishers register

```sh
npx lloyal-ai publishers register --handle <handle> [--yes]
```

Claim a publisher handle and accept the publisher terms. Registration requires an interactive terminal
and browser authentication; service tokens cannot register an identity.

| Option | Meaning and default |
| --- | --- |
| `--handle <handle>` | Required handle, matching `[a-z][a-z0-9_-]{1,63}`. The `lloyal` handle is reserved. |
| `--yes` | Accept the displayed publisher terms without the additional confirmation prompt. Registration still requires a terminal; this is not a CI-registration mode. No `-y` alias. |
| `-h`, `--help` | Show help. |

## publishers me

```sh
npx lloyal-ai publishers me
```

Show the authenticated identity's publisher record. Supports browser authentication or a service token.
No arguments or options beyond `-h`/`--help`.

## publish

```sh
npx lloyal-ai publish [--dir <path>] [--endpoint <url>]
```

Submit a built ability for review. The command reads `ability.json` and `package.json`, resolves the
registered publisher, runs `npm pack`, and uploads the bundle. Approval signs the artifact and adds it
to the channel; submission alone leaves it pending.

| Option | Meaning and default |
| --- | --- |
| `--dir <path>` | Ability directory. Default: current directory. |
| `--endpoint <url>` | Submission endpoint. Default: `https://api.lloyal.ai/v1/publish`. Overrides the submission endpoint only. |
| `-h`, `--help` | Show help. |

```sh
npx lloyal-ai publish --dir ./case-files
```

## publish status

```sh
npx lloyal-ai publish status <submissionId>
```

Fetch the current review status once. The ID is returned by `publish`; the result can include approval
or rejection details. Uses the same authentication as `publish`. The only options are `-h`/`--help`.

## Contributor commands

These commands connect an application or template to local platform checkouts.

### link-local

```sh
npx lloyal-ai link-local <hdk-workspace> [--node <lloyal.node-repo>]
```

Run from an application or template directory containing `package.json`. Link its platform dependencies
to a local HDK workspace and install the remaining dependencies. Build the linked packages before use.
The command restores `package.json` and preserves the lockfile; its lasting changes are in `node_modules`.

| Argument or option | Meaning and default |
| --- | --- |
| `<hdk-workspace>` | HDK checkout containing `packages/`. |
| `--node <lloyal.node-repo>` | Native binding checkout. If omitted, look for sibling `lloyal-node` or `lloyal.node` repositories beside the HDK checkout. |
| `-h`, `--help` | Show help. |

### unlink-local

```sh
npx lloyal-ai unlink-local
```

Remove the current project's `node_modules`, including the local links. Run `npm install` afterward to
restore published dependencies from the unchanged manifests. Requires `package.json` in the current
directory. No arguments or options beyond `-h`/`--help`.

## Internal review commands

These commands require Lloyal channel-review authorization. They use browser authentication or authorized
Cloudflare Access service tokens and are separate from an application developer's publishing workflow.

### review list

```sh
npx lloyal-ai review list [--status <status>] [--limit <n>] [--cursor <cursor>]
```

| Option | Meaning and default |
| --- | --- |
| `--status <status>` | `pending`, `approved`, or `rejected`. Default: `pending`. |
| `--limit <n>` | Requested page size, forwarded to the service. Default: service-defined. |
| `--cursor <cursor>` | Continue from the previous response's `nextCursor`. Default: first page. |
| `-h`, `--help` | Show help. |

### review inspect

```sh
npx lloyal-ai review inspect <submissionId> [--extract <dir>]
```

Show submission metadata and its manifest stub. `<submissionId>` is required. `--extract <dir>` saves
the submitted `.tgz` bundle in that directory for inspection; it does not unpack its contents.
Without the option, print the inspection URL when available. Also accepts `-h`/`--help`.

### review approve

```sh
npx lloyal-ai review approve <submissionId>
```

Approve the submission for signing and channel publication. `<submissionId>` is required; the only
options are `-h`/`--help`.

### review reject

```sh
npx lloyal-ai review reject <submissionId> --reason <text>
```

Reject the submission. Both `<submissionId>` and `--reason <text>` are required; the reason must contain
at least three characters. Quote reasons containing spaces. Also accepts `-h`/`--help`.

## Non-interactive behavior

| Operation | Requirements outside an interactive terminal |
| --- | --- |
| `new` | Supply a name and desired flags. Install npm dependencies separately unless explicitly requested with `--backend-pack download`. Default abilities are still fetched unless `--skip-abilities` is set. |
| `install` | Configure required services in advance; there is no prompt to add them. |
| `targets:remove` | Supply `--yes`. |
| `backends:install` | Supply `--yes` if a backend download is required. |
| `ship` | Configure `ship.id`, the icon, and any requested signing/notarization credentials beforehand. |
| `publish`, `publish status` | Supply publisher service-token credentials. |
| `publishers register` | Registration requires an interactive terminal, including with `--yes`. |

Command behavior is defined by the [dispatcher](../src/cli.ts), [registry](../src/commands/index.ts), and
[command implementations](../src/commands). The `npm run ...` commands for a generated application are
documented under [Deployment surfaces](running-and-configuring.md#deployment-surfaces).
