/**
 * An article's life: asked, worked, answered — and the ONLY place the trunk is written, the trunk being the
 * model's running memory of this page. What the model does in between is `wiki.ts`, which returns a value and
 * writes nothing.
 *
 * The rule that shapes it: no handler waits on the model. Each hands its work to `run` and returns at once,
 * which is what keeps a Stop heard while an answer is still being written.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoped } from "effection";
import type { Channel, Operation } from "effection";
import type { Session } from "@lloyal-labs/sdk";
import type { Branch } from "@lloyal-labs/sdk";
import { useAgent, waitUntilSettled } from "@lloyal-labs/lloyal-agents";
import { defineOutput } from "@lloyal-labs/rig";
import { listFolders, reserveFolder } from "@lloyal-labs/rig/node";
import type { Execution, Handlers } from "@lloyal-labs/rig";
import { z } from "zod";
import { write } from "./wiki.js";
import { prompt } from "./prompts.js";
import type { Command, Group, WorkflowEvent } from "../protocol.js";
import { errorMessage } from "../protocol.js";

/** The file whose existence says a folder IS an article. Named once — a literal repeated is a literal that drifts. */
const RECORD = "article.json";

/**
 * What is kept: facts, and nothing else. Four fields, because every field a demo does not need is a field a
 * reader has to decide is irrelevant — and deliberately NOT this app's own types, which change with a release
 * while a file on disk lives for years. `version` is what lets a later shape be read or refused rather than
 * misread.
 */
const Article = z.object({
  version: z.literal(1),
  query: z.string(),
  savedAt: z.string(),
  answer: z.string(),
});
export type Article = z.infer<typeof Article>;

/** A kept article and the folder that holds it. The folder name IS the identity, so the record does not carry one. */
export type Saved = Article & { id: string };

/**
 * How the model hands the grouping in. `defineOutput` is the other half of the tool contract: a Tool is what
 * an agent CALLS to get something it lacks, while this is how it hands a structured answer BACK. The schema
 * is the contract — the shape of the answer is known before any logic is read — and `read` returns it typed
 * or null, never half-parsed.
 */
const topics = defineOutput(
  "topics",
  z.object({ groups: z.array(z.object({ topic: z.string(), ids: z.array(z.string()) })) }),
);

/**
 * Which saved articles belong together, and what to call each pile — a fast structured decision from the
 * resident LLM, JEV-style.
 *
 * At LOAD rather than at save, which is the whole design: classifying one article as it is written is a
 * decision made blind to the others and then baked into a file nothing revisits, so "Batteries" and "Battery
 * technology" accumulate forever. Here the model sees every article at once, so a coherent set of topics is a
 * property of the call — and nothing on disk depends on a model answering, because the grouping is never
 * stored. `?? []` is the degradation, in the same expression that does the work.
 */
export function* classifyTopics(kept: Saved[], trunk: Branch | null): Operation<Group[]> {
  const agent = yield* useAgent({
    ...prompt("topics", { articles: kept.map(({ id, query }) => ({ id, query })) }),
    terminal: topics.tool,
    parent: trunk ?? undefined,
    budget: { maxTurns: 2 },
    enableThinking: false,   // a label, not a deliberation — thinking here would cost more than the answer
  });
  return topics.read(agent)?.groups ?? [];
}

export interface Articles {
  handlers: Handlers<Command>;
  /** Say what is on the shelf. Called at boot, and again whenever a turn adds to it. */
  shelf(): Operation<void>;
  /** Group the shelf by topic and say it again. Runs on its own — the landing must never wait for a model. */
  classify(): Operation<void>;
  /** Accept a question. Returns as soon as the run is ACCEPTED, and what it returns IS the run — the loop
   *  drops it, which is what keeps it free; the one-shot path awaits it. */
  submit(query: string): Operation<Operation<void>>;
  /** Whatever is in flight stops, and the surface is told. Also what the app gives up after a handler threw
   *  on a healthy run — `serveDefaults`' `abandon` — so the next question starts clean. */
  abortRun(): Operation<void>;
}

export function articles(deps: {
  session: Session;
  run: Execution;
  wire: Channel<WorkflowEvent, void>;
  /** Where articles are kept — `sources.outputDir`, read each time so a change of config is honoured. */
  root: () => string;
}): Articles {
  const { session, run, wire, root } = deps;
  let turnInFlight = false;
  let asked = 0;
  /** The record this session's article IS — what a follow-up extends, and what memory is rebuilt from. */
  let page: string | null = null;
  /** The record the model's memory holds in full. Null means it cannot be trusted: a turn that stopped or
   *  failed may have committed a pair nobody was shown, so the next question rebuilds rather than continues. */
  let remembered: string | null = null;

  return {
    handlers: {
      *submit_query(c) {
        yield* submit(c.query);
      },
      *stop() {
        yield* abortRun();
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
      articles: kept.map(({ id, query, savedAt }) => ({ id, query, savedAt })),
      groups,
    });
  }

  function* classify(): Operation<void> {
    const kept = saved(root());
    if (kept.length < 2) return;   // one pile is not a grouping
    // Through `run` like any other model work, and for the same reason: one owner means a question evicts the
    // grouping and waits for its cleanup, rather than the two reaching the model at once. Returns as soon as
    // the run is accepted, so the landing still paints without waiting for it.
    yield* run.replace("classify", () =>
      scoped(function* () {
        try {
          const groups = yield* classifyTopics(kept, null);
          if (groups.length > 0) yield* shelf(groups);
        } catch {
          // The shelf stays flat and every record is untouched. Nothing a reader asked for failed, so this is
          // not worth a toast — and it must never take the session with it.
        }
      }),
    );
  }

  function* submit(query: string): Operation<Operation<void>> {
    yield* abortRun();
    // What the READER is told — is there an article on the page to extend. Whether the model still remembers
    // that page is a different question with a different answer, asked inside the run once the previous one's
    // cleanup is done; asking it here would read a trunk that is still being torn down.
    yield* wire.send({ type: "query", text: query, warm: page !== null });
    turnInFlight = true;
    return yield* run.replace(`ask-${++asked}`, () =>
      // `scoped` is the boundary: whatever the program starts — agents, forks of the model's state — is
      // finished and cleaned up before this run counts as over, so the next one never meets its leftovers.
      scoped(function* () {
        try {
          const article = yield* write(yield* recalled(), query);
          if (!article) {
            turnInFlight = false;
            return yield* wire.send({ type: "answer", text: null });
          }
          // Disk first: the record is what memory is rebuilt from, so it has to exist before memory changes.
          const id = keep(root(), query, article);
          page = id;
          remembered = null;
          // The reader has it before anything else can fail, which is what keeps the three in agreement: what
          // is saved, what is on screen, and what the next question continues from are all this article.
          yield* wire.send({ type: "answer", text: article });
          // Memory after the reader, so a failure here costs the conversation and never the page — the next
          // question rebuilds it from the record.
          yield* rebase(session, query, article);
          remembered = id;
          turnInFlight = false;
          yield* shelf();   // last, so the shelf arriving is the whole turn being over
        } catch (err) {
          // Already stopped: this is the halt arriving, and it is `run`'s to judge — a cleanup that failed
          // means the model's state cannot be trusted.
          if (!turnInFlight) throw err;
          turnInFlight = false;
          remembered = null;   // a turn that died may have committed a pair nobody was shown
          yield* wire.send({ type: "run:aborted" });
          yield* wire.send({ type: "ui:error", message: errorMessage(err) });
          throw err;   // recorded on the run's future: the loop drops it, the one-shot path exits with it
        }
      }),
    );
  }

  /** The model's memory of the page, as this turn may use it: the trunk when it is trusted, and otherwise one
   *  rebuilt from the page's own record — never from whichever folder happens to be newest. */
  function* recalled(): Operation<Branch | null> {
    if (page === null) return null;
    if (remembered === page && session.trunk) return session.trunk;
    const record = saved(root()).find((a) => a.id === page);
    if (!record) return null;
    yield* rebase(session, record.query, record.answer);
    remembered = page;
    return session.trunk;
  }

  function* abortRun(): Operation<void> {
    const dying = turnInFlight;
    // Withdraws an accepted run and halts a live one. Returns at once; `run.busy` holds until the model settles.
    yield* run.stop();
    turnInFlight = false;
    if (dying) {
      remembered = null;   // it may have committed a pair nobody was shown; the next question rebuilds
      yield* wire.send({ type: "run:aborted" });
    }
  }
}

/**
 * Keep the article, and say which record it became — the folder's name is the identity, so the caller needs it
 * back to know what this session's page now is.
 *
 * The markdown is a projection a human or a corpus can read; the record is the commit. The ordering is the
 * whole lesson, which is why these are two calls to the SAME function: a crash between them leaves a folder
 * holding markdown and no record, and `listFolders` does not list it — correctly, because a half-written turn
 * is not an article.
 */
function keep(root: string, query: string, answer: string): string {
  const id = reserveFolder(root);
  const dir = join(root, id);
  const record: Article = { version: 1, query, savedAt: new Date().toISOString(), answer };
  writeFileSync(join(dir, "article.md"), `# ${query}\n\n${answer}\n`, "utf8");
  writeFileSync(join(dir, RECORD), `${JSON.stringify(record, null, 2)}\n`, "utf8");   // last: its existence is the commit
  return id;
}

/** Every kept article, oldest first — the folder names are ISO-stamped, so the listing's own order is time's.
 *  A record that cannot be read or does not fit the shape is skipped rather than failing the listing. */
export function saved(root: string): Saved[] {
  return listFolders(root, RECORD).flatMap(({ name, path }) => {
    try {
      const parsed = Article.safeParse(JSON.parse(readFileSync(path, "utf8")));
      return parsed.success ? [{ id: name, ...parsed.data }] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Put the page on the trunk as it now stands, rather than appending another copy beside the drafts it
 * supersedes: `dispose` releases what the trunk held, which leaves `commitTurn` its cold path — fresh branch,
 * prefill, promote. Append instead and the trunk ends up holding every revision of the page.
 *
 * Nothing is restored if this fails. It does not need to be: the record on disk is what the page is, and the
 * next question rebuilds memory from it.
 */
function* rebase(session: Session, query: string, article: string): Operation<void> {
  // How a call into the model is awaited: a halt cannot drop a call already inside the model half way.
  yield* waitUntilSettled(session.dispose());
  yield* waitUntilSettled(session.commitTurn(query, article));
}
