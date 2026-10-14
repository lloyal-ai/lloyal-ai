# Glass Phase 1 implementation

Glass starts as a standalone application over released public HDK packages. The research scaffold supplied boot, transport, provisioning, content and ability wiring. Its fixed research stages and brief-specific product model have been replaced with conversational composition.

## Invariants

1. One command owner commits the durable conversation trunk. One pure fold composes framework facts and Glass state. Model output cannot establish runtime activity, admission or available controls.
2. Harness code consumes public APIs only. Effection owns work and yielding cleanup; native settlement precedes replacement/disposal. A missing public contract belongs in a framework issue.
3. Submitted questions, accepted answers, explicitly kept partials and typed/media references persist. Reopen prefills portable trunk data; it neither loads KV snapshots nor resumes unfinished workers or replays old tool side effects.
4. Auto chooses useful work at meaningful boundaries. Direct, Plan, Parallel, Chain and Graph express manual constraints; abilities and presentation stay independent. Plans and revisions are validated before execution.
5. Accepted findings pass explicitly through public parallel/chain/fanout/DAG composition and synthesis. Sibling state is not implicitly merged. Plan changes settle the previous attempt before rebuilding affected work.
6. Stop preserves acknowledged turns. Finish requires an explicit Resume while paused. Discard is an explicit separate user action. Reading saved history does not transfer the live work owner.
7. Source previews and actual admitted representations remain distinct. Media is content-addressed. PDFs belong to Documents; supported Markdown resources belong to Corpus.
8. Keep the approved design: Inter, edge-to-edge electric depth, compact frosted navigation, short travelling reflections, contextual controls and no decorative idle animation. During observed work, a single diffuse background wash shifts slowly across the canvas; there are no per-agent light shapes. Pause, reading and reduced motion keep it still.

## Reading and evidence presentation

Owner review sets one shared desktop measure of 840 px for answers, work panels, document cards and the composer, with fluid gutters on smaller viewports. Main prose is 16 px and table content 14 px. Document cards open by default but remain collapsible. Titles, metadata and actions have distinct emphasis, shared across evidence/source/activity disclosures. The composer includes a small muted verification reminder below the input, within its own dock.

The history drawer is 280 px wide, capped at viewport width minus 32 px. Its compact rows stay unchanged; its vertical scroll area uses the same thin, muted thumb and transparent track as the document strip. A stable scrollbar gutter avoids title-width shifts.

## Build sequence and owners

| Slice             | Owning code                                                                     | Result                                                                            |
| ----------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Foundation        | `app.ts`, `protocol.ts`, `harness/conversations.ts`, `storage.ts`, target boots | Shared wire/fold, direct turns, saves and reconstruction                          |
| Composer/evidence | UI composer/history/evidence parts, public voice/media hooks                    | Independent modes/abilities, attachments, bounded dictation and source inspection |
| Composition       | `harness/decisions.ts`, `work.ts`, `outputs.ts`, Eta prompts, domain contracts  | Validated typed decisions and public orchestration                                |
| Steering          | Conversation owner, `steering.ts`, work control                                 | Source restrictions, plan revisions, pause/resume/finish/stop                     |
| Product surfaces  | Shared fold/selectors, UI parts, `field.ts`                                     | Work tabs, typed answers, selections, history and runtime motion                  |
| Release           | Test scenarios/native journeys, deployment config and CLI template              | Clean installs, package/host checks and reviewable receipts                       |

[Verification](verification.md) separates implemented behavior, actual tests, counterexamples and outstanding acceptance gates. The [reference mock](design/reference.html) specifies appearance and interaction; simulated results are not tests.

## Deferred capabilities

Streaming ASR/TTS, live camera/video, new multimodal embedding services, automatic all-service model fitting, unsupported source-region anchors and new host transports remain outside Phase 1. Recorded dictation produces an editable transcript after recording and the app replies in text.
