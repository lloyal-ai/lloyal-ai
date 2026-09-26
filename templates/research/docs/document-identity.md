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
| the KV | which document's thread the trunk holds right now (the brief keeps this, harness-side) |

No translation layer exists between them, and none may be added: the id IS
the join.

## The laws

**Birth is the only fresh state.** A new document is a new `DocState` entry.
Nothing run-scoped is ever cleared, reset, or reused — a document another
document cannot reach cannot go stale. Session facts (config, abilities,
library, pressure) have no reset path at all.

**Events route by identity, not by position.** The reducer's routing table is
total over the wire: every event goes to the session, to the document the run
is writing, to a case of its own, or is ignored on purpose — none is dropped
by omission. The three query arms are total: warm + settled answer → an ask INTO that doc; known
id → idempotent re-echo; unknown id → birth. Stragglers with no run drop.

**An ask never leaves `done`.** A follow-up streams beneath the settled
document; its run machinery works while the doc's phase stays `done`. This
is the rule that lets one total table map a phase to its moment, its status
word and whether the model is working, with no overrides. The picker is not a phase — it is `activeDocId === null`.

**The KV law: the trunk holds at most one document's thread.** The brief
speaks Session verbs only — it never manages a branch's lifetime itself. At
every accepted ask, under the run (so Stop can reach it), the brief asks one
question: does the trunk hold THIS document's thread, whole, with every pair
closed? If yes, the ask threads onto it. If not, the trunk is released and
rebuilt: a settled document comes back from its report on disk, a new one
starts clean. A stopped or failed run is never trusted to have left the trunk
whole, so the next ask rebuilds. Opening a document from the library touches
no KV at all: warmth is rebuilt lazily, at the first ask into it, never on
navigation. The one answer generated straight from the trunk runs on a FORK
of it; the brief commits the pair afterwards.

**The URL is derived state.** On the web target, `src/ui/history.ts` mirrors
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
