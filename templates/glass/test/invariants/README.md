# Harness contract tests

Run `npm test` on Node 24. These tests execute the real Glass harness, command owner, persistence and UI fold using public `@lloyal-labs/rig/testing`. Scripted model outputs make ordering and failure cases reproducible. They establish application contracts, not model judgment or answer quality.

For a regression, first add a minimal counterexample and run it against unchanged application code. Record the expected failure before fixing it. Keep a nearby positive control so a fix cannot pass by rejecting all work or clearing every finding. Keep both tests in CI.

`composition-contracts.test.ts` covers stage transitions and acceptance: refused/failed/capped/empty prerequisites, independent sibling progress, presentation consistency, initial versus revisit mode constraints, and typed answer/evidence retention during clarification.

`composition-lineage.test.ts` varies sequence capacity and worker duration. Its oracle uses public trace fork positions and spine-extension receipts, independently of Glass's `influencedBy` metadata. A revision must withdraw findings that inherited the changed premise while preserving accepted findings that did not. This matrix exercises queued admission without wall-clock sleeps.

The other scenarios cover persistence, source restrictions, stale approvals, interruption, pause/resume/finish, citations and UI projections. Async test functions await completed harness runs; runtime work remains Effection operations. Compose public execution owners, register yielding cleanup with `ensure()`, and use the public settlement boundary for SDK promises. Do not create promise-based lifecycle coordination inside harness operations.

CI runs the invariants, target typechecks and web/desktop builds on Linux, macOS and Windows. Native journeys in `test/native/` are separate: use the intended model and a dedicated process/project directory. A deterministic pass does not establish native lifetime, model quality, browser interaction, performance or all release gates. See [verification](../../docs/verification.md).
