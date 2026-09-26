/**
 * Settled briefs on disk, and the folders reserved for briefs still being
 * written — over rig's folder mechanics. A brief's record is `report.json`:
 * the facts of the run that wrote it, and the ONLY file the library reads
 * back. Beside it the library writes what a reader opens — the answer as
 * `report.md`, what each inquiry said as `annexure-N.md` — and an ask into a
 * settled brief lands as `exchange-N.json` with its own `exchange-N.md`. The
 * record is written LAST: a folder whose record is missing was never settled,
 * whatever else it holds. Every settled brief becomes retrievable ground for
 * the next one: the corpus ability, when enabled, indexes the markdown and is
 * re-indexed after every settle.
 *
 * Every served session owns its own record over the SAME library, so a file
 * name is a reservation, never an observation: annexures and exchanges are
 * created exclusively, and a name another session took is skipped.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ensure } from "effection";
import type { Channel, Operation } from "effection";
import { z } from "zod";
import { Attachments, waitUntilSettled } from "@lloyal-labs/lloyal-agents";
import { asAttachment, MANIFEST_TYPE } from "@lloyal-labs/media";
import type { Attachment, AttachmentStore, Descriptor } from "@lloyal-labs/media";
import type { EventBus } from "@lloyal-labs/binding";
import { abilityToc, service } from "@lloyal-labs/rig";
import type { AbilityFactory, AbilityRegistry, Execution, Handlers } from "@lloyal-labs/rig";
import { confined, listFolders, removeFolder, reserveFolder } from "@lloyal-labs/rig/node";
import { config } from "../config.js";
import type { Inputs, Written } from "../harness/research.js";
import type { Command, DocId, LibraryEntry, Thread, WorkflowEvent } from "../protocol.js";
import { errorMessage } from "../protocol.js";

const CORPUS = "corpus";
const RECORD = "report.json";

/** What a brief's record says — the facts of the run that wrote it, never the engine's types, which change per
 *  release while a file lives for years. `version` names this shape; a record of another shape is not read. */
export const BriefRecord = z.object({
  version: z.literal(1),
  /** The question — the brief's title, or the exchange's. */
  query: z.string(),
  savedAt: z.string(),
  mode: z.enum(config["defaults.reasoningMode"].oneOf),
  effort: z.enum(config["defaults.effort"].oneOf),
  /** The question was the plan: one agent, no planner. */
  direct: z.boolean(),
  /** Root manifest digests: the ask's own, then every root a tool result admitted. */
  attachments: z.array(z.string()),
  answer: z.string(),
  /** What each line of inquiry found, in plan order — empty for one that found nothing. */
  inquiries: z.array(z.object({ task: z.string(), findings: z.string() })),
  elapsedMs: z.number(),
  synthTokens: z.number().optional(),
  synthPpl: z.number().optional(),
});
export type BriefRecord = z.infer<typeof BriefRecord>;

/** A record read from disk, or null for a file that is not one. */
export const asBriefRecord = (json: string): BriefRecord | null => {
  try {
    const parsed = BriefRecord.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** The one writer of a brief's files, for a first report or an exchange beside a settled one: the markdown a
 *  reader opens first — one annexure per inquiry that found something, then the answer with its meta line and
 *  the index of those annexures — and the record LAST, so a crash before it leaves a folder that was never
 *  settled. An annexure's name is reserved, never assumed: another session may be writing beside this one. */
export function writeBrief(dir: string, record: BriefRecord, opts: { exchange: boolean; annexuresFrom: number }): void {
  const refs: string[] = [];
  record.inquiries.forEach(({ task, findings }, i) => {
    if (!findings.trim()) return;
    const n = reserveName(dir, "annexure", ".md", opts.annexuresFrom + i + 1);
    fs.writeFileSync(path.join(dir, `annexure-${n}.md`), `# Annexure ${n}\n\n${task ? `**Task:** ${task}\n\n` : ""}---\n\n${findings.trimEnd()}\n`, "utf8");
    refs.push(`- [Annexure ${n}](./annexure-${n}.md)${task ? ` — ${task}` : ""}`);
  });
  const annexures = refs.length ? `\n---\n\n## Annexures\n\n${refs.join("\n")}\n` : "";
  const stats = `${record.synthTokens ? ` · ${record.synthTokens} synth tokens` : ""}${record.synthPpl !== undefined ? ` · ppl ${record.synthPpl.toFixed(2)}` : ""}`;
  const media = record.attachments.length > 0 ? ` · media ${record.attachments.join(" ")}` : "";
  const meta = `> ${record.savedAt} · ${record.mode} · ${record.effort}${record.direct ? " · ask" : ""}${stats} · ${(record.elapsedMs / 1000).toFixed(1)}s${media}`;
  const doc = `# ${record.query}\n\n${meta}\n\n${record.answer.trim()}\n${annexures}`;
  const name = opts.exchange ? `exchange-${reserveName(dir, "exchange", ".json", 1)}` : "report";
  fs.writeFileSync(path.join(dir, `${name}.md`), doc, "utf8");
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(record, null, 2) + "\n", "utf8");
}

/** Create `<dir>/<prefix>-<n><ext>` for the first free n ≥ `from`, exclusively. */
function reserveName(dir: string, prefix: string, ext: string, from: number): number {
  for (let n = from; ; n++) {
    try {
      fs.closeSync(fs.openSync(path.join(dir, `${prefix}-${n}${ext}`), "wx"));
      return n;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

/** The record at a confined path, or null where there is none to read. */
const readRecord = (file: string): BriefRecord | null => {
  try { return asBriefRecord(fs.readFileSync(file, "utf8")); } catch { return null; }
};

/** What the library keeps for one brief's run: where it writes, and what its inquiries said. */
interface RunRecord {
  docId: DocId;
  dir: string;
  query: string;
  mode: BriefRecord["mode"];
  /** What the reader chose for THIS run. Recorded so a reopened brief wears the dial that wrote it, not the current one. */
  effort: BriefRecord["effort"];
  direct: boolean;
  /** Root manifest digests the ask carried, then every root a tool result admitted. */
  attachments: string[];
  /** An ask into a settled brief: the answer lands as an exchange beside the report. */
  appending: boolean;
  /** Annexure numbers the folder already held when this run began: this run's annexures are numbered after them. */
  ordinalBase: number;
  startedAt: number;
  /** What the writer returned, held until the run says `complete`. */
  written: Written | null;
}

/** The roots a thread recorded, rebuilt from what the store actually holds: a digest whose manifest is gone is dropped. */
function heldRoots(store: AttachmentStore, digests: readonly string[]): Attachment[] {
  const roots: Attachment[] = [];
  for (const digest of digests) {
    const bytes = store.getManifest(digest) ? store.get(digest) : null;
    if (bytes) roots.push({ mediaType: MANIFEST_TYPE, digest, size: bytes.length } as Attachment);
  }
  return roots;
}

export interface Library {
  handlers: Handlers<Command>;
  /** A fresh, exclusive folder — the brief's identity from now on. */
  reserve(): DocId;
  /** The folder goes, unless a brief settled in it (its record reads); the record stops writing for it. */
  release(id: DocId): void;
  /** The record starts: a first report, or a thread beside a settled one. */
  begin(id: DocId, ask: Inputs, opts: { warm: boolean }): void;
  /** What the writer returned for the brief being written. The report is made from it when the run says `complete`. */
  written(id: DocId, written: Written): void;
  /** A settled brief, its pictures checked against the store; null when there is none. */
  read(id: DocId): Thread | null;
  unfinished(id: DocId): boolean;
  /** The assets available to a run: the thread's recorded roots plus this ask's own. Roots only. */
  roots(id: DocId, own: readonly Descriptor[]): Operation<Attachment[]>;
  /** The run is over. A folder that holds a record is settled: off the reserved set, and the sources that read the
   *  shelf re-index (the record was written the moment `complete` was said — before anyone could act on it — and
   *  the list announced with it). One that holds none was never settled — the run found nothing — and is released. */
  settled(id: DocId): Operation<void>;
  /** The roots a settled brief holds in the store, as descriptors for the wire. */
  restored(thread: Thread): Operation<Descriptor[]>;
}

export function* openLibrary(
  dir: () => string,
  deps: { events: EventBus<WorkflowEvent>; registry: AbilityRegistry; wire: Channel<WorkflowEvent, void>; run: Execution; abilities: readonly AbilityFactory[] },
): Operation<Library> {
  const { events, registry, wire, run, abilities } = deps;
  /** The unfinished reservations this session owns. */
  const reserved = new Set<DocId>();
  let record: RunRecord | null = null;
  // `ensure` registers cleanup with whoever called `openLibrary` — here the session. It runs when the session
  // ends, however it ends, so a folder reserved for a brief that never settled does not outlive it.
  yield* ensure(() => { for (const id of [...reserved]) release(id); });

  const recordPath = (id: DocId): string | null => confined(dir(), path.join(dir(), id, RECORD));
  /** Whether a brief settled in its folder: it holds a record that READS. A file that exists but does not (a write
   *  cut short) settles nothing — the folder is as unsettled as one with no record, and is treated the same. */
  const settledIn = (id: DocId): boolean => { const file = recordPath(id); return file !== null && readRecord(file) !== null; };

  /** Every settled brief's record, newest first — a folder without one, or with one of another shape, is not listed. */
  function records(): { path: string; docId: DocId; record: BriefRecord }[] {
    const found: { path: string; docId: DocId; record: BriefRecord }[] = [];
    for (const { name, path: file } of listFolders(dir(), RECORD)) {
      const r = readRecord(file);
      if (r) found.push({ path: file, docId: name, record: r });
    }
    return found.sort((a, b) => (a.record.savedAt < b.record.savedAt ? 1 : -1));
  }

  const list = (): LibraryEntry[] =>
    records().map(({ path: file, docId, record: r }) => ({
      path: file, docId, title: r.query, savedAt: r.savedAt, mode: r.mode, effort: r.effort, direct: r.direct, hasMedia: r.attachments.length > 0,
    }));

  function release(id: DocId): void {
    if (record?.docId === id) record = null;
    const folder = path.join(dir(), id);
    if (fs.existsSync(folder) && !settledIn(id)) removeFolder(folder);
    reserved.delete(id);
  }

  function read(id: DocId): Thread | null {
    const file = recordPath(id);
    const root = file === null ? null : readRecord(file);
    if (file === null || root === null) return null;
    const folder = path.dirname(file);
    // Each exchange passes the same test the report did: a regular file directly inside the real folder.
    const realDir = fs.realpathSync(folder);
    const inside = (name: string): string | null => {
      try {
        const real = fs.realpathSync(path.join(folder, name));
        return path.dirname(real) === realDir && fs.statSync(real).isFile() ? real : null;
      } catch { return null; }
    };
    const exchanges = fs.readdirSync(folder)
      .map((name) => /^exchange-(\d+)\.json$/.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => inside(m[0]))
      .filter((p): p is string => p !== null)
      .map((p) => readRecord(p))
      .filter((r): r is BriefRecord => r !== null);
    return {
      docId: id, title: root.query, body: root.answer, attachments: root.attachments,
      mode: root.mode, effort: root.effort, direct: root.direct,
      exchanges: exchanges.map((e) => ({ question: e.query, body: e.answer, attachments: e.attachments })),
      thread: [root.answer, ...exchanges.map((e) => `---\n\n# ${e.query}\n\n${e.answer}`)].join("\n\n"),
    };
  }

  /** The corpus ability re-reads its path on enable: a settled brief joins the index. Says `corpus:indexed`. */
  function* reindex(): Operation<void> {
    if (!registry.byName(CORPUS)) return;
    const factory = abilities.find((f) => f.manifest?.name === CORPUS);
    if (!factory) return;
    try {
      yield* registry.disable(CORPUS);
      const ability = yield* registry.enable(factory);
      const toc = abilityToc(ability);
      yield* wire.send({ type: "corpus:indexed", corpusPath: "", fileCount: toc ? toc.split("\n").filter(Boolean).length : 0, chunkCount: 0 });
    } catch (err) {
      yield* wire.send({ type: "ui:error", message: `Corpus re-index failed: ${errorMessage(err)}` });
    }
  }

  /** The brief's files, written as the run's `complete` is said, from what the writer returned. Synchronous, on
   *  the bus, so the files exist before any reader of `complete` acts. A writer that found nothing writes nothing. */
  function finish(r: RunRecord): void {
    const w = r.written;
    if (!w?.answer) return;
    writeBrief(r.dir, {
      version: 1, query: r.query, savedAt: new Date().toISOString(), mode: r.mode, effort: r.effort, direct: r.direct,
      attachments: r.attachments, answer: w.answer.trim(), inquiries: w.inquiries, elapsedMs: Date.now() - r.startedAt,
      ...(w.complete.synthTokens !== undefined ? { synthTokens: w.complete.synthTokens } : {}),
      ...(w.complete.synthPpl !== undefined ? { synthPpl: w.complete.synthPpl } : {}),
    }, { exchange: r.appending, annexuresFrom: r.ordinalBase });
  }

  /** The two things the library takes from the bus, because no value carries them: the roots a tool admitted
   *  while the run worked, and the moment the run says it is over. `events` is the bus itself, and a subscriber
   *  is a plain callback that runs as each event is said — which is why the report can be on disk before anyone
   *  else hears `complete`. (`wire.send` is the way to SAY something from inside an operation.) */
  const unsubscribe = events.subscribe((ev) => {
    const r = record;
    if (!r) return;
    if (ev.type === "agent:prefilled") {
      // A tool result that carried roots admitted them: booked with the run, so the record carries them.
      for (const a of ev.attachments ?? []) if (!r.attachments.includes(a.digest)) r.attachments.push(a.digest);
    } else if (ev.type === "complete") {
      // A settle is a library change, said unasked — on the bus directly, in the same breath as `complete`,
      // so no reader of it finds the shelf stale.
      finish(r);
      record = null;
      events.send({ type: "library:list", entries: list() });
    }
  });
  yield* ensure(() => unsubscribe());

  // The corpus, when enabled at boot, has indexed the library already: say so for the composer's chip.
  const corpus = registry.byName(CORPUS);
  if (corpus) {
    const toc = abilityToc(corpus);
    yield* wire.send({ type: "corpus:indexed", corpusPath: "", fileCount: toc ? toc.split("\n").filter(Boolean).length : 0, chunkCount: 0 });
  }

  return {
    handlers: {
      *library_list() {
        yield* wire.send({ type: "library:list", entries: list() });
      },
      *library_search({ query }) {
        // The reranker is the run's instrument while a run is live; the sidebar disables its input, this is the same fact host-side.
        if (run.busy) return;
        const q = query.trim();
        const entries = q ? records() : [];
        if (!q || entries.length === 0) return yield* wire.send({ type: "library:search", query: q, ranked: [] });
        const texts = entries.map(({ record: r }) => `${r.query}\n\n${r.answer.slice(0, 400)}`);
        const reranker = yield* service("reranker");
        let scores: number[];
        try { scores = yield* waitUntilSettled(reranker.scoreBatch(q, texts)); }
        catch (err) { return yield* wire.send({ type: "ui:error", message: `Search failed: ${errorMessage(err)}` }); }
        const ranked = entries.map((e, i) => ({ path: e.path, score: scores[i] ?? -Infinity })).sort((a, b) => b.score - a.score).map((r) => r.path);
        yield* wire.send({ type: "library:search", query: q, ranked });
      },
      *library_delete({ path: candidate }) {
        // The whole folder goes — report, annexures, thread — and the corpus unlearns it.
        const file = confined(dir(), candidate);
        if (file !== null && path.basename(file) === RECORD) { removeFolder(path.dirname(file)); yield* reindex(); }
        yield* wire.send({ type: "library:list", entries: list() });
      },
    },
    reserve() {
      const id = reserveFolder(dir());
      reserved.add(id);
      return id;
    },
    release,
    begin(id, ask, { warm }) {
      const folder = path.join(dir(), id);
      // A brief whose run was stopped before its report lost its folder with the stop but not its place on the
      // canvas: an ask into it writes its first report, so the folder is back and reserved again.
      fs.mkdirSync(folder, { recursive: true });
      const settledAlready = warm && settledIn(id);
      if (!settledAlready) reserved.add(id);
      let taken = 0;
      if (settledAlready) for (const name of fs.readdirSync(folder)) { const m = /^annexure-(\d+)\.md$/.exec(name); if (m) taken = Math.max(taken, Number(m[1])); }
      record = {
        docId: id, dir: folder, query: ask.text, mode: ask.mode, effort: ask.effort, direct: ask.direct,
        attachments: ask.attachments.map((a) => a.digest),
        appending: settledAlready, ordinalBase: taken, startedAt: Date.now(), written: null,
      };
    },
    written(id, w) { if (record?.docId === id) record.written = w; },
    read,
    unfinished: (id) => reserved.has(id),
    *roots(id, own) {
      const store = yield* Attachments.expect();
      const thread = read(id);
      const digests = thread ? [...thread.attachments, ...thread.exchanges.flatMap((x) => x.attachments)] : [];
      const roots = new Map<string, Attachment>();
      for (const r of heldRoots(store, digests)) roots.set(r.digest, r);
      for (const d of own) { const a = asAttachment(d); if (a) roots.set(a.digest, a); }
      return [...roots.values()];
    },
    *restored(thread) {
      const store = yield* Attachments.expect();
      return heldRoots(store, thread.attachments);
    },
    *settled(id) {
      if (!settledIn(id)) return release(id);   // nothing settled in it: the run found nothing, or its record never landed
      reserved.delete(id);
      yield* reindex();
    },
  };
}
