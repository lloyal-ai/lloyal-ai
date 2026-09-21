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
import { ensure, scoped } from "effection";
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
    try {
      const groups = yield* classifyTopics(kept, session.trunk);
      if (groups.length > 0) yield* shelf(groups);
    } catch {
      // The shelf stays flat and every record is untouched. Nothing a reader asked for failed, so this is
      // not worth a toast — and it must never take the session with it, which an uncaught spawn would.
    }
  }

  function* submit(query: string): Operation<Operation<void>> {
    yield* abortRun();
    const trunk = session.trunk;
    yield* wire.send({ type: "query", text: query, warm: trunk !== null });
    turnInFlight = true;
    return yield* run.replace(`ask-${++asked}`, () =>
      // `scoped` is the boundary: whatever the program starts — agents, forks of the model's state — is
      // finished and cleaned up before this run counts as over, so the next one never meets its leftovers.
      scoped(function* () {
        try {
          const article = yield* write(trunk, query);
          if (article) {
            yield* rebaseTrunk(session, query, article);
            keep(root(), query, article);
          }
          turnInFlight = false;
          yield* wire.send({ type: "answer", text: article });
          if (article) yield* shelf();
        } catch (err) {
          // Already stopped: this is the halt arriving, and it is `run`'s to judge — a cleanup that failed
          // means the model's state cannot be trusted.
          if (!turnInFlight) throw err;
          turnInFlight = false;
          yield* wire.send({ type: "run:aborted" });
          yield* wire.send({ type: "ui:error", message: errorMessage(err) });
          throw err;   // recorded on the run's future: the loop drops it, the one-shot path exits with it
        }
      }),
    );
  }

  function* abortRun(): Operation<void> {
    const dying = turnInFlight;
    // Withdraws an accepted run and halts a live one. Returns at once; `run.busy` holds until the model settles.
    yield* run.stop();
    turnInFlight = false;
    if (dying) yield* wire.send({ type: "run:aborted" });
  }
}

/**
 * The page IS the state, so the trunk is re-based on the article as it now stands rather than having another
 * copy appended beside the drafts it supersedes. Clearing it first is what selects that: with no trunk,
 * `commitTurn` takes its cold path — fresh branch, prefill, promote — and promote's `retainOnly` reclaims the
 * old one. Append instead and the trunk ends up holding every revision of the page.
 */
/**
 * Keep the article. The markdown is a projection a human or a corpus can read; the record is the commit.
 *
 * The ordering is the whole lesson, which is why these are two calls to the SAME function: a crash between
 * them leaves a folder holding markdown and no record, and `listFolders` does not list it — correctly, because
 * a half-written turn is not an article.
 */
function keep(root: string, query: string, answer: string): void {
  const dir = join(root, reserveFolder(root));
  const record: Article = { version: 1, query, savedAt: new Date().toISOString(), answer };
  writeFileSync(join(dir, "article.md"), `# ${query}\n\n${answer}\n`, "utf8");
  writeFileSync(join(dir, RECORD), `${JSON.stringify(record, null, 2)}\n`, "utf8");   // last: its existence is the commit
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

function* rebaseTrunk(session: Session, query: string, article: string): Operation<void> {
  const superseded = session.trunk;
  session.trunk = null;
  yield* scoped(function* () {
    // `ensure`, not `catch`: quitting mid-turn HALTS this, and a halt is not an error anything here can catch.
    // Until `promote` lands there is no new trunk, so leaving it null would drop the article and open the next
    // question on a blank page. Better to lose the turn than the page.
    yield* ensure(() => {
      if (!session.trunk) session.trunk = superseded;
    });
    // How a call into the model is awaited: a halt cannot drop a call already inside the model half way.
    yield* waitUntilSettled(session.commitTurn(query, article));
  });
}
