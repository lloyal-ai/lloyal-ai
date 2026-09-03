# Document identity

One document, one identity, birth to disk. A `docId` — ISO-timestamp shaped,
minted once by the harness at the query echo — names the same document on
every surface:

| surface | how the id appears |
|---|---|
| the fold | `documents: Map<DocId, DocState>`; `activeDocId` (canvas), `runDocId` (run) |
| the wire | `query.docId` (the birth certificate), `doc.docId`, `doc:active.docId` |
| the disk | the run-dir folder: `<outputDir>/<docId>/report.md` + exchanges + annexures |
| the URL | `/brief/<docId>` (web target only; the URL is a projection of `activeDocId`) |
| the KV | which document owns `session.trunk` right now (`trunkDocId`, harness-side) |

No translation layer exists between them, and none may be added: the id IS
the join.

## The laws

**Birth is the only fresh state.** A new document is a new `DocState` entry.
Nothing run-scoped is ever cleared, reset, or reused — a document another
document cannot reach cannot go stale. Session facts (config, abilities,
library, pressure) have no reset path at all.

**Events route by identity, not by position.** The reducer's `SCOPE` table
sends each event to the session or to `documents.get(runDocId)`. The three
query arms are total: warm + settled answer → an ask INTO that doc; known
id → idempotent re-echo; unknown id → birth. Stragglers with no run drop.

**An ask never leaves `done`.** A follow-up streams beneath the settled
document; its run machinery works while the doc's phase stays `done`. This
is the rule that lets `MOMENT_OF` and `STATUS_OF` be plain total tables with
no overrides. The picker is not a phase — it is `activeDocId === null`.

**The KV law: at most one document-owned branch exists.** The harness speaks
Session verbs only — never Branch lifecycle. At the submit boundary:
halt the run (its subtree dies at teardown) → `session.dispose()` iff the
trunk belongs to another doc (RESTRICT prune enforces the invariant at
runtime: switching with run children alive throws) → echo → the cold
`commitTurn` path lazily creates the new doc's branch when conversation
first lands. Reopens rebuild warmth from disk the same lazy way
(`commitOpenedReport` at first submit, never on navigation). The single
sanctioned raw-Branch usage is `runPassthrough`'s generation on the trunk —
generation, not lifecycle.

**The URL is derived state.** `targets/web/history.ts` mirrors
`activeDocId` out (`pushState`, guarded) and folds `popstate` back in as an
`open_doc` command. Navigation is view-only and legal during runs — the run
keeps writing into `runDocId`'s state wherever the canvas looks. Lifecycle
never rides the URL: a brief being framed and that brief settled are the
same address.

## Why this file exists

A design that lets each surface hold its own notion of "the document" — a
reused fold slot with a reset matrix, an omnibus KV trunk, a mutable disk
anchor, a view with no identity at all — breeds its staleness bugs in the
seams between them: ghost content, one brief's prose under another's title,
warmth a document never earned. The laws above make those states
unrepresentable. Keep it that way: if a change needs a second identity, a
compensating override in a selector, or a reset list, the design is wrong
at the seam this document names.
