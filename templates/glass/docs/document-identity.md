# Conversation identity and lifetime

The conversation record is Glass's durable unit. A session may view one record while its execution continues working on another. Navigation changes the view; only an explicit control changes the live execution.

`src/harness/conversations.ts` owns submitted turns, active work, the resident trunk and commits. `src/harness/storage.ts` owns versioned JSON records, revision checks and atomic replacement. All targets consume `src/protocol.ts` and the same pure fold in `src/ui/reduce.ts`.

| Identity        | Meaning                                                            |
| --------------- | ------------------------------------------------------------------ |
| Conversation ID | Stable UUID, filename and `/conversation/<id>` route               |
| Record revision | Optimistic write/selection/command guard                           |
| Turn ID         | Submitted question, accepted answer, evidence and controls         |
| Work owner      | Conversation and turn whose owned operation is running             |
| Plan revision   | Approved dependency graph; stale approvals are rejected            |
| Content digest  | Original, extracted or projected media in the public content plane |

The owner saves the question before acknowledging submission. It saves accepted answers and explicitly retained partial answers independently of trace capture. Writes use an exclusive temporary file, file fsync and atomic rename. Linux/macOS additionally fsync the containing directory after rename or removal. Windows rejects that directory-handle flush (`EPERM`), so it uses the flushed file plus rename without claiming a durable directory metadata barrier. Process-restart reconstruction is tested; sudden-power-loss durability, especially Windows rename/removal metadata, has not been demonstrated. One host process owns a conversation directory; its sessions coordinate live claims in that process. This is not a distributed database or a per-user access boundary.

Reopening prefills the saved trunk with its source and media references. It does not load KV snapshots, replay old tool side effects or restore unfinished workers. Repeated reopen must not duplicate turns. A pending turn without a live owner appears interrupted; Continue begins new work from the retained conversation. A missing media object or invalid record is reported rather than silently substituted.

Work runs on an owned spine forked from that trunk. Parallel, chain, fanout and DAG composition use public agents APIs. Accepted findings pass explicitly into dependent stages and synthesis. Sibling state is not implicitly merged. A revised DAG settles the prior owned attempt, retains unaffected accepted findings and validates the next plan. Selectively preserving live branches across revisions is not claimed.

Discard acts on selected saved content. Removing a turn leaves later turns saved; it invalidates affected references and forces reconstruction. Removing a conversation does not delete shared content blobs. Trace files are diagnostic, not a persistence acknowledgement.

The browser stores drafts and display preferences locally. Conversation records and the library live on the host. All sessions using one host can read that library, so deployments need their own access boundary when privacy between people is required.
