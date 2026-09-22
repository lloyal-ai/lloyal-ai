/**
 * An article's life: asked, worked, answered — and the ONLY place the trunk is written, the trunk being the
 * model's running memory of this page. What the model does in between is `wiki.ts`, which returns a value.
 *
 * No handler waits on the model. Each hands its work to `run` and returns at once, which is what keeps a Stop
 * heard while an answer is still being written.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoped } from "effection";
import type { Channel, Operation } from "effection";
import type { Session } from "@lloyal-labs/sdk";
import type { Branch } from "@lloyal-labs/sdk";
import { waitUntilSettled } from "@lloyal-labs/lloyal-agents";
import { listFolders, reserveFolder } from "@lloyal-labs/rig/node";
import type { Execution, Handlers } from "@lloyal-labs/rig";
import { z } from "zod";
import { write } from "./wiki.js";
import { classifyTopics } from "./classify.js";
import type { Command, DocId, Group, WorkflowEvent } from "../protocol.js";
import { errorMessage } from "../protocol.js";

/** The file whose existence says a folder IS an article. */
const RECORD = "article.json";

/** What is kept. Facts only, never this app's own types: a file outlives the release that wrote it, and
 *  `version` is what lets a later shape be refused rather than misread. */
const Article = z.object({
  version: z.literal(1),
  query: z.string(),
  savedAt: z.string(),
  answer: z.string(),
});
export type Article = z.infer<typeof Article>;

/** A kept article and the folder holding it. The folder's name is the identity, so the record carries none. */
export type Saved = Article & { docId: DocId };

export interface Articles {
  handlers: Handlers<Command>;
  /** Say what is on the shelf. */
  shelf(): Operation<void>;
  /** Group the shelf by topic and say it again. */
  classify(): Operation<void>;
  /** Accept a question. Returns once the run is ACCEPTED, and what it returns IS the run: the loop drops it,
   *  the one-shot path awaits it. */
  submit(query: string): Operation<Operation<void>>;
  /** Whatever is in flight stops; a turn that ends before its article reached the reader says so. Also
   *  `serveDefaults`' `abandon`. */
  abortRun(): Operation<void>;
}

/** One question's life. Each run closes over its own, so a turn being torn down never reads a newer one's. */
interface Turn {
  /** Its article has reached the reader, so it is the page whatever becomes of the rest of the turn. */
  published: boolean;
}

export function articles(deps: {
  session: Session;
  run: Execution;
  wire: Channel<WorkflowEvent, void>;
  /** Where articles are kept, read each time so a change of config is honoured. */
  root: () => string;
}): Articles {
  const { session, run, wire, root } = deps;
  /** The turn now running; a stopped or replaced one is no longer it. */
  let activeTurn: Turn | null = null;
  let asked = 0;
  /** The record the page shows — what a question extends, and what memory is rebuilt from. Null is the landing. */
  let page: DocId | null = null;
  /** The record the model's memory holds in full; null when that cannot be trusted. */
  let remembered: DocId | null = null;

  return {
    handlers: {
      *submit_query(c) {
        yield* submit(c.query);
      },
      *stop() {
        yield* abortRun();
      },
      *open_doc({ docId }) {
        yield* openDoc(docId);
      },
    },
    shelf,
    classify,
    submit,
    abortRun: () => abortRun(),
  };

  function* shelf(groups: Group[] | null = null): Operation<void> {
    const kept = saved(root());
    yield* wire.send({
      type: "library",
      articles: kept.map(({ docId, query, savedAt }) => ({ docId, query, savedAt })),
      groups,
    });
  }

  function* classify(): Operation<void> {
    const kept = saved(root());
    if (kept.length < 2) return;   // one pile is not a grouping
    // Through `run` like any other model work, so a question evicts it rather than sharing the context.
    yield* run.replace("classify", () =>
      scoped(function* () {
        try {
          // A fast structured decision from the resident LLM, JEV-style.
          const groups = yield* classifyTopics(kept);
          if (groups.length > 0) yield* shelf(groups);
        } catch {
          // A flat shelf, and every record untouched. Nothing a reader asked for failed.
        }
      }),
    );
  }

  /** Put a kept article on the page, or with null leave for the landing — which paints, then regroups, since it
   *  is about to be seen. Whatever is running stops first; the next question rebuilds memory from the record. */
  function* openDoc(docId: DocId | null): Operation<void> {
    if (activeTurn && !activeTurn.published) return;   // that turn is still deciding what the page is
    if (docId === null) {
      if (page === null) return;
      yield* abortRun();
      page = null;
      yield* wire.send({ type: "doc:active", docId: null });
      yield* shelf();
      return yield* classify();
    }
    const record = saved(root()).find((a) => a.docId === docId);
    if (!record) return yield* wire.send({ type: "ui:error", message: "That article is no longer there." });
    yield* abortRun();
    page = docId;
    yield* wire.send({ type: "doc", docId, title: record.query, answer: record.answer });
    yield* wire.send({ type: "doc:active", docId });
  }

  function* submit(query: string): Operation<Operation<void>> {
    yield* abortRun();
    // Whether there is a page to extend. Whether the MODEL still holds it is `recalled()`, inside the run.
    yield* wire.send({ type: "query", text: query, warm: page !== null });
    const turn: Turn = { published: false };
    activeTurn = turn;
    return yield* run.replace(`ask-${++asked}`, () =>
      // `scoped` finishes whatever the program started — agents, forks of the model's state — before this run
      // counts as over, so the next one never meets its leftovers.
      scoped(function* () {
        try {
          const article = yield* write(yield* recalled(), query);
          if (!article) {
            if (activeTurn === turn) activeTurn = null;
            return yield* wire.send({ type: "answer", text: null });
          }
          // The order is the point: disk, then the reader, then memory. What is saved, what is on screen and
          // what the next question continues from cannot disagree, and a failure late costs only the last.
          const docId = keep(root(), query, article);
          page = docId;
          remembered = null;
          turn.published = true;
          yield* wire.send({ type: "answer", text: article });
          yield* rebase(session, query, article);
          if (activeTurn === turn) {
            remembered = docId;
            activeTurn = null;
          }
          yield* shelf();   // last, so the shelf arriving is the whole turn being over
        } catch (err) {
          // Stopped or replaced: the halt is arriving, and it is `run`'s to judge.
          if (activeTurn !== turn) throw err;
          activeTurn = null;
          remembered = null;
          if (!turn.published) yield* wire.send({ type: "run:aborted" });
          yield* wire.send({ type: "ui:error", message: errorMessage(err) });
          throw err;   // the run's future records it: the loop drops it, the one-shot path exits with it
        }
      }),
    );
  }

  /** The model's memory of the page: the trunk while it is trusted, else one rebuilt from the page's own
   *  record — never from whichever folder is newest. */
  function* recalled(): Operation<Branch | null> {
    if (page === null) return null;
    if (remembered === page && session.trunk) return session.trunk;
    const record = saved(root()).find((a) => a.docId === page);
    if (!record) return null;
    yield* rebase(session, record.query, record.answer);
    remembered = page;
    return session.trunk;
  }

  function* abortRun(): Operation<void> {
    const dying = activeTurn;
    activeTurn = null;
    // Returns at once; `run.busy` holds until the model settles.
    yield* run.stop();
    if (dying) {
      remembered = null;   // it may have committed a pair nobody was shown, or been cut mid-update
      if (!dying.published) yield* wire.send({ type: "run:aborted" });
    }
  }
}

/**
 * Keep the article, and say which record it became.
 *
 * Two calls to the SAME function, and their order is the commit: a crash between them leaves markdown with no
 * record, which `listFolders` does not list — correctly, because a half-written turn is not an article.
 */
function keep(root: string, query: string, answer: string): DocId {
  const docId = reserveFolder(root);
  const dir = join(root, docId);
  const record: Article = { version: 1, query, savedAt: new Date().toISOString(), answer };
  writeFileSync(join(dir, "article.md"), `# ${query}\n\n${answer}\n`, "utf8");
  writeFileSync(join(dir, RECORD), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return docId;
}

/** Every kept article, oldest first — the folder names are ISO-stamped. One that cannot be read is skipped. */
export function saved(root: string): Saved[] {
  return listFolders(root, RECORD).flatMap(({ name, path }) => {
    try {
      const parsed = Article.safeParse(JSON.parse(readFileSync(path, "utf8")));
      return parsed.success ? [{ docId: name, ...parsed.data }] : [];
    } catch {
      return [];
    }
  });
}

/** Put the page on the trunk as it now stands: `dispose` releases what the trunk held, which leaves
 *  `commitTurn` its cold path. Appending instead would keep every revision of the page. */
function* rebase(session: Session, query: string, article: string): Operation<void> {
  // A halt cannot drop a call already inside the model half way.
  yield* waitUntilSettled(session.dispose());
  yield* waitUntilSettled(session.commitTurn(query, article));
}
