# Verification record — 14 October 2026

This is a working Phase 1 implementation for review, not a signed release or a completed human suitability study. The CLI, desktop and web targets share the command owner and fold. Each claim below identifies its evidence boundary.

## Reproduce

Use Node 24, then `npm ci`, `npm run typecheck`, `npm test`, `npm run build:web` and `npm run build:desktop`. The lockfile records the tested resolution. `npm run dev:web` provisions the declared models and runs the real host and renderer; `npm run dev:desktop` uses the desktop target. Production web deployment is described in [hosting](hosting.md).

Native protocol journeys run against an already-running Glass host:

```sh
GLASS_WS=ws://127.0.0.1:8788/ GLASS_SEED=42 npm run test:native -- Auto "Why is the sky blue? Explain in two sentences."
GLASS_WS=ws://127.0.0.1:8788/ GLASS_EXCLUDED= npm run test:native -- Parallel "Compare only these supplied facts: A costs 120 units plus 20 delivery; B costs 135 including delivery. Independently check each total and combine them into a small table showing which is cheaper."
GLASS_WS=ws://127.0.0.1:8788/ GLASS_FIXTURE=test/fixtures/inspection-image.pdf npm run test:native -- Direct "Inspect page 1. Name the shapes in left-to-right order and cite the page."
```

`test/native/host-journey.ts` uses the public web binding and writes events and accepted records into ignored `verification/native/`. By default it disables external abilities to isolate fixtures; `GLASS_EXCLUDED=` keeps installed abilities available. It automatically approves valid Plan/Graph proposals, so this is not a test of human approval or browser rendering. `GLASS_CONVERSATION` reopens a saved conversation. `GLASS_FINISH_ON_PLAN=1` asks to finish before approving the proposed work and expects an honestly partial answer. Receipts include seed, duration, timeout and the actual accepted result. Completion alone is not a quality pass.

`test/native/trunk.ts`, `sessions.ts` and `voice.ts` cover process-restart reconstruction, hosted admission/isolation and bounded transcription. Run text, vision and ASR checks in their intended model processes. Keep full receipts locally; review them for keys, uploaded content and private queries before publishing. The checked-in [summary](verification-results.json) contains only controlled fixtures and selected outcomes.

## Tested environment

- Linux x86-64 Brev host, NVIDIA L40S 48 GB, Node 24.15.0. Web deployment uses the public host plus Caddy 2.11.7 on the same origin; maximum two active sessions in the admission check.
- CLI 1.18.1; rig 6.0.0; agents 7.0.0; SDK 5.0.0; lloyal.node 4.0.0; binding 0.2.1; desktop 0.3.0; UI 0.2.0; media 0.2.1. No workspace links or private/addon imports in the harness.
- Signed Web 3.0.0, Corpus 3.0.0, Documents 0.3.0 and Wikipedia 3.0.0 artifacts installed by the CLI. Glass does not modify their implementations.
- Main configuration: Qwen3.5-4B Q4_K_M, 32,768 context, eight branches, matching vision projector, Qwen3 reranker 0.6B Q8 and Qwen3-ASR 0.6B Q8 with its matching projector. `harness.yml` and the resolved provisioning manifest identify artifacts.
- Separate SmolLM2 text-mechanics process, and separate Qwen3-ASR transcription process. Small-model errors are retained; they are not attributed to the main Qwen configuration.
- macOS Apple Silicon: an unsigned Glass 0.1.0 DMG built by the public `lloyal ship` command. The installed app provisioned its five model artifacts, opened, answered 18 + 24 = 42, then quit and reopened the saved conversation before answering the contextual follow-up as 21 in Auto. This does not establish notarization or every desktop journey.
- Current peer-compatible Vite 7.3.7 is retained because electron-vite 5 does not accept the newer major. The package audit reported five low-severity entries through the public UI's KaTeX dependency; no supported automatic fix was available. No incompatible transitive override was introduced.

The final invariant suite passes **37/37** checks; all three target typechecks and both application builds pass.

## Evidence matrix

| Area              | Verified                                                                                                                                                                                                                                                  | Limit                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence       | Real harness scenarios save with tracing disabled; repeated reopen, stale writes, unsupported records, interrupted requests, selected discard and Continue are covered. A real process restart recovered the codeword MARIGOLD without duplicating turns. | One host process owns each conversation directory. Shared library is not a private multi-user access boundary.                                                                                                                           |
| Composition       | All six modes exercised through real hosted UI. Deterministic tests exercise public parallel, chain, fanout and DAG handoffs, rejection of failed prerequisites, mode constraints and invalid/cyclic plans.                                               | Quality of task decomposition remains model-dependent. A passing schema is not a useful plan by itself.                                                                                                                                  |
| Steering          | Editable Graph plan revised and approved in the browser; pause/resume, stop and referenced follow-ups exercised. Invariants cover stale approvals, source restriction, retained partials and explicit Resume before Finish.                               | Revising a running DAG settles the old attempt and retains unaffected accepted findings; it does not keep unaffected live branches running. Native interruption during every possible tool/recovery boundary is not exhaustively tested. |
| Typed outputs     | Native comparison totals 140/135/difference 5, chain area 40 and cost 800, exactly three checklist items. Table/cell selection, referenced follow-up, persisted plan/table and checklist edits tested.                                                    | Arbitrary generated content still requires task-specific review.                                                                                                                                                                         |
| Evidence          | PDF text query returns 45 parcels with page citation. Vision admits the actual rendered page and correctly identifies blue circle then red square. Saved valid citation opens the correct page preview. Exact admitted representation appears separately. | Original PDF bytes return 200/application/pdf; this in-app browser left the embedded PDF viewer blank. A direct new-tab link is provided. Precise unsupported region anchors remain Phase 2.                                             |
| Voice             | Public bounded-recording/transcription path: cancel and synthetic speech transcription pass with the intended ASR model/projector. Composer and history use the same public voice hooks and waveform.                                                     | Physical microphone permission/capture and a human spoken history search have not been validated. No streaming ASR or spoken answers are claimed.                                                                                        |
| Hosted sessions   | Two Qwen sessions retained distinct HARBOR/MARIGOLD codewords; a third queued and was admitted after release; no cross-talk in the controlled check.                                                                                                      | This is admission/isolation verification, not a concurrency capacity or cost benchmark.                                                                                                                                                  |
| Browser           | Plan edit/approve, all modes, selected-worker tab keyboard navigation, cell reference follow-up, history text search, Escape/focus restoration, reduced motion and narrow viewport without horizontal overflow.                                           | A full browser/device accessibility audit is not claimed.                                                                                                                                                                                |
| Provision/package | Clean registry installation, five real model artifacts, web/desktop builds and native first answer. New CLI Glass scaffold fetched signed abilities, built both targets and produced “Glass scaffold is ready.”                                           | CLI integration awaits review/release; `@latest` does not include this new template until published. DMG is unsigned and unnotarized.                                                                                                    |

## Counterexamples and fixes

The first typed Direct result used a discriminated union that the model answered with `{}`. The output is now one flat typed contract, with optional table/checklist data. Attachment-backed Direct answers must pass the typed output boundary; malformed attachment URLs in both source fields and prose are rejected using the public attachment grammar. A real retry on the same saved document conversation produced a valid digest/page citation. Historical invalid answers remain unchanged in the local record.

An earlier Parallel run used web search to verify a supplied hypothetical price and added an unnecessary qualification. Decision and worker prompts now preserve “only these supplied facts” as a source restriction. The same browser query then produced the correct 140/135 comparison without that qualification. This correction is not proof of universal instruction following.

The Documents ability rejects a simple vector-only second page as text-only, even though it contains meaningful shapes. A raster-page fixture succeeds. This is tracked at the framework boundary (LLO-82); Glass has no private rendering workaround. Public Markdown can treat paired currency amounts as inline math (LLO-83). Prompts request escaped currency; existing content is not silently rewritten and the renderer is not forked.

An early Finish fixture exposed inconsistent table row widths. Table-shape refinement now rejects that result at the public typed-output boundary while the agent can still correct it. Decision grammars also restrict source and attachment names to those available for the current request, retaining semantic validation after parsing. A subsequent native Finish-before-approval run kept its answer as partial.

An Auto follow-up after reopening asked for clarification despite the original numbers being present in the reconstructed trunk; Direct recalled them correctly. Initial Auto decisions now receive a bounded excerpt of the last accepted exchange (up to 2,000 question characters and 4,000 answer characters) alongside inherited conversation context. Three newly reconstructed native sessions then answered 18 + 24 as 42, half that as 21, and recalled both original numbers. These are selected functional checks, not a universal recall or reasoning-efficiency result. The earlier failed answers remain preserved.

A SmolLM2 isolation run shortened HARBOR to HARB. The Qwen main-model isolation run passed all three codeword checks. Native completion receipts preserve both outcomes.

## Remaining release gates

- Human review of answer suitability, including the child-facing explanation/register cases. Two seeds were exercised for simple and ambiguous requests; these do not establish safety or broad quality.
- Physical microphone journeys on the intended browser and desktop, including denied permission and history-search dictation.
- Signed/notarized desktop package and the complete journey matrix on that image, using the owner's signing credentials.
- Measured M2 first-useful-response and motion-overhead targets. Native protocol timings here are exploratory, include inference work, and are not UI animation measurements. The 400 ms and under-2% CPU/GPU targets have not been demonstrated.
- Review and release of the third-template CLI change; owner acceptance of the Phase 1 issue gates. Current framework limitations above remain visible.

## Design and ownership

The [approved reference](design/reference.html) is a simulated design artifact; it supplies no production state. The real application uses bundled Inter, a full-screen electric canvas, a compact frosted drawer, independent mode/ability popovers, finite corner reflection, compact work tabs and a separate accepted answer. See [implementation](implementation-plan.md) and [conversation lifetime](document-identity.md).
