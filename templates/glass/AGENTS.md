# Working in Glass

After every context compaction, before editing:

1. Reread docs/implementation-plan.md and the current owner-authorized plan and issue acceptance criteria (including Linear when available).
2. Reopen the corrected high-fidelity reference in docs/design/reference.html. Compare the actual UI with it before changing layout, motion or interaction.
3. Read this file, README.md and the owning source files. Reconcile live code with the plan; the mock simulates behavior and is never proof of implementation.

## Architecture

Compose released public HDK APIs. A harness never touches the addon, loads a native binary or reaches into private handles. Raise a missing framework capability at its owning boundary.

The research scaffold supplies boot, transport, acquisition, content and ability wiring. Glass owns its product policy. Do not retain mandatory research stages, brief-only persistence, fixed personas or stacked worker reports.

One conversation command owner writes the trunk. One pure UI fold composes the public agent fold. Views send commands through HarnessProvider and read projections; they do not call models.

Use Effection operations for owned work. Yield, spawn or join every operation. Use ensure for yielding cleanup, and waitUntilSettled at native promise boundaries. Never put async/await, dangling promises or hand-built cancellation inside an operation module. Execution owns replace/stop and waits for teardown.

Persist submitted questions, accepted answers, explicitly kept partial answers, media references and interruption status. Rebuild inference state by portable prefill. No KV snapshots. Diagnostic trace files never acknowledge durable writes.

## Product

Preserve the approved full-screen electric canvas, Inter, compact frosted history drawer, independent mode and ability popovers, and finite corner-travelling reflection. Auto composes work as required; manual modes constrain intent. Do not expose simulated controls as working features.

Keep Phase 2 services outside Phase 1. Recorded dictation is supported; streaming speech, live camera/video and new model-fit/embedding services are separate platform work.

## Implementation discipline

Read before deleting scaffold code. Use current public package types and the CLI basic/research templates when APIs are unclear.
Keep all prompt prose in Eta files. Use defineOutput for typed outcomes and the framework citation capture for grounded prose. Do not add JSON extractors, inference schedulers or alternative citation weaving.
Abilities are signed artifacts installed by the CLI, never edited or replaced with local imitations.
Use simple independent owners and explicit rules. Public source and documentation must stand alone without private tracker links.
Pin the tested dependency resolution in package-lock.json. Use the latest supported releases; record peer-range constraints rather than forcing incompatible dependencies.

## Verification

See docs/verification.md. Run typecheck, invariants, web and desktop builds after relevant changes. Use the real harness over rig/testing for deterministic contracts.
Real-model tests use the intended models: SmolLM2 for text mechanics, Qwen3.5-4B plus its matching projector for vision, Qwen3-ASR plus its projector for recorded audio. Run model-specific suites in separate processes. Never infer capability from a build or mock.
Browser tests must exercise the real transport and harness for end-to-end claims. Verify keyboard, reduced motion, responsive layout and console errors.
