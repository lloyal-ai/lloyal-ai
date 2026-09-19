/**
 * Settled briefs on disk, in the brief's report format, and the folders
 * reserved for briefs still being written — over rig's folder mechanics. Also
 * the run record: what a brief's inquiries said is written beside its report
 * as `annexure-N.md`, and the answer as `report.md` (or, for an ask into a
 * settled brief, `exchange-N.md`). Every settled brief becomes retrievable
 * ground for the next one: the corpus ability, when enabled, is re-indexed
 * after every settle.
 *
 * Every served session owns its own record over the SAME library, so a file
 * name is a reservation, never an observation: annexures and exchanges are
 * created exclusively, and a name another session took is skipped.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ensure } from "effection";
import type { Channel, Operation } from "effection";
import { Attachments, RerankerCtx, waitUntilSettled } from "@lloyal-labs/lloyal-agents";
import type { AbilityFactory, AbilityRegistry } from "@lloyal-labs/lloyal-agents";
import type { Effort } from "../research/budgets.js";
import type { Mode } from "./protocol.js";
import { asAttachment, MANIFEST_TYPE } from "@lloyal-labs/media";
import type { Attachment, AttachmentStore, Descriptor } from "@lloyal-labs/media";
import type { EventBus } from "@lloyal-labs/binding";
import { abilityToc } from "@lloyal-labs/rig";
import type { Execution, Handlers } from "@lloyal-labs/rig";
import { confined, listFolders, removeFolder, reserveFolder } from "@lloyal-labs/rig/node";
import type { Inputs, Written } from "../research/research.js";
import type { Command, DocId, LibraryEntry, Thread, WorkflowEvent } from "./protocol.js";
import { errorMessage } from "./protocol.js";

const CORPUS = "corpus";

/** What the library keeps for one brief's run: where it writes, and what its inquiries said. */
interface RunRecord {
  docId: DocId;
  dir: string;
  query: string;
  mode: "flat" | "deep";
  /** What the reader chose for THIS run. Recorded so a reopened brief wears the dial that wrote it, not the current one. */
  effort: Effort;
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

/** Create `<dir>/<prefix>-<n>.md` for the first free n ≥ `from`, exclusively. */
function reserveName(dir: string, prefix: string, from: number): number {
  for (let n = from; ; n++) {
    try {
      fs.closeSync(fs.openSync(path.join(dir, `${prefix}-${n}.md`), "wx"));
      return n;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

/** The report's raw stream may carry a leaked reasoning block; the exported report keeps only the brief. */
const stripThink = (text: string): string => {
  const close = text.lastIndexOf("</think>");
  return close === -1 ? text : text.slice(close + "</think>".length);
};

/**
 * What the meta line records about the run that wrote it: the reasoning mode, the effort, and whether the
 * ask went straight to one agent. Every field is OPTIONAL by construction — reports written before a field
 * existed simply lack it, and must keep reading back, so a missing value is `null`/`false`, never a parse
 * failure. The reader falls back to their own dial only when the record genuinely does not say.
 */
export function provenanceOf(metaLine: string): { mode: Mode | null; effort: Effort | null; direct: boolean } {
  const m = /^> (?:\S+) · (flat|deep)(?: · (low|medium|high|ultra))?(?: · (ask))?/.exec(metaLine);
  return { mode: (m?.[1] as Mode | undefined) ?? null, effort: (m?.[2] as Effort | undefined) ?? null, direct: m?.[3] === "ask" };
}

/** Parse a confined report file: the title from the `# query` line, the roots off the meta line, the body past the 3-line header. */
function readReport(file: string): { title: string; body: string; attachments: string[] } & ReturnType<typeof provenanceOf> {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const meta = lines[2] ?? "";
  const media = /·\s*media\s+((?:sha256:[0-9a-f]{64}\s*)+)/.exec(meta);
  return {
    title: (lines[0] ?? "").replace(/^#\s*/, "") || "Reopened report",
    body: lines.slice(3).join("\n").trim(),
    attachments: media ? (media[1] ?? "").trim().split(/\s+/) : [],
    ...provenanceOf(meta),
  };
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
  /** The folder goes, unless a report settled in it; the record stops writing for it. */
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
  /** The brief settled: off the reserved set, and the sources that read the shelf re-index. The report itself was
   *  written the moment `complete` was said — before anyone could act on it — and the list announced with it. */
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

  const reportPath = (id: DocId): string | null => confined(dir(), path.join(dir(), id, "report.md"));

  function list(): LibraryEntry[] {
    const entries: LibraryEntry[] = [];
    for (const { name, path: file } of listFolders(dir(), "report.md")) {
      let text: string;
      try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
      const [titleLine = "", , metaLine = ""] = text.split("\n");
      const stamp = /^> (\S+) /.exec(metaLine);
      const prov = provenanceOf(metaLine);
      entries.push({
        path: file, docId: name,
        title: titleLine.replace(/^#\s*/, "") || name,
        savedAt: stamp?.[1] ?? name,
        mode: prov.mode,
        effort: prov.effort,
        direct: prov.direct,
        hasMedia: /·\s*media\s+sha256:/.test(metaLine),
      });
    }
    return entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  }

  function release(id: DocId): void {
    if (record?.docId === id) record = null;
    const folder = path.join(dir(), id);
    if (fs.existsSync(folder) && !fs.existsSync(path.join(folder, "report.md"))) removeFolder(folder);
    reserved.delete(id);
  }

  function read(id: DocId): Thread | null {
    const file = reportPath(id);
    if (file === null) return null;
    const root = readReport(file);
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
      .map((name) => /^exchange-(\d+)\.md$/.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => inside(m[0]))
      .filter((p): p is string => p !== null)
      .map((p) => readReport(p));
    return {
      docId: id, title: root.title, body: root.body, attachments: root.attachments,
      mode: root.mode, effort: root.effort, direct: root.direct,
      exchanges: exchanges.map((e) => ({ question: e.title, body: e.body, attachments: e.attachments })),
      thread: [root.body, ...exchanges.map((e) => `---\n\n# ${e.title}\n\n${e.body}`)].join("\n\n"),
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

  /** The report, written as the run's `complete` is said, from what the writer returned: one annexure per inquiry
   *  that found something, then the answer with its meta line and the index of those annexures — as `report.md`,
   *  or as an exchange beside a settled one. Synchronous, on the bus, so the files exist before any reader of
   *  `complete` acts. An annexure's name is reserved, never assumed: another session may be writing beside this one. */
  function finish(r: RunRecord): void {
    const w = r.written;
    if (!w?.answer) return;
    const refs: string[] = [];
    w.inquiries.forEach(({ task, findings }, i) => {
      if (!findings.trim()) return;
      const n = reserveName(r.dir, "annexure", r.ordinalBase + i + 1);
      fs.writeFileSync(path.join(r.dir, `annexure-${n}.md`), `# Annexure ${n}\n\n${task ? `**Task:** ${task}\n\n` : ""}---\n\n${findings.trimEnd()}\n`, "utf8");
      refs.push(`- [Annexure ${n}](./annexure-${n}.md)${task ? ` — ${task}` : ""}`);
    });
    const annexures = refs.length ? `\n---\n\n## Annexures\n\n${refs.join("\n")}\n` : "";
    const { synthTokens, synthPpl } = w.complete;
    const stats = `${synthTokens ? ` · ${synthTokens} synth tokens` : ""}${synthPpl !== undefined ? ` · ppl ${synthPpl.toFixed(2)}` : ""}`;
    const media = r.attachments.length > 0 ? ` · media ${r.attachments.join(" ")}` : "";
    const meta = `> ${new Date().toISOString()} · ${r.mode} · ${r.effort}${r.direct ? " · ask" : ""}${stats} · ${((Date.now() - r.startedAt) / 1000).toFixed(1)}s${media}`;
    const doc = `# ${r.query}\n\n${meta}\n\n${stripThink(w.answer).trim()}\n${annexures}`;
    if (r.appending) fs.writeFileSync(path.join(r.dir, `exchange-${reserveName(r.dir, "exchange", 1)}.md`), doc, "utf8");
    else fs.writeFileSync(path.join(r.dir, "report.md"), doc, "utf8");
  }

  /** The two things the library takes from the bus, because no value carries them: the roots a tool admitted
   *  while the run worked, and the moment the run says it is over. `events` is the bus itself, and a subscriber
   *  is a plain callback that runs as each event is said — which is why the report can be on disk before anyone
   *  else hears `complete`. (`wire.send` is the way to SAY something from inside an operation.) */
  const unsubscribe = events.subscribe((ev) => {
    const r = record;
    if (!r) return;
    if (ev.type === "agent:prefilled") {
      // A tool result that carried roots admitted them: booked with the run, so the meta line carries them.
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
        const entries = q ? list() : [];
        if (!q || entries.length === 0) return yield* wire.send({ type: "library:search", query: q, ranked: [] });
        const texts = entries.map((e) => { try { const r = readReport(e.path); return `${r.title}\n\n${r.body.slice(0, 400)}`; } catch { return e.title; } });
        const reranker = yield* RerankerCtx.expect();
        let scores: number[];
        try { scores = yield* waitUntilSettled(reranker.scoreBatch(q, texts)); }
        catch (err) { return yield* wire.send({ type: "ui:error", message: `Search failed: ${errorMessage(err)}` }); }
        const ranked = entries.map((e, i) => ({ path: e.path, score: scores[i] ?? -Infinity })).sort((a, b) => b.score - a.score).map((r) => r.path);
        yield* wire.send({ type: "library:search", query: q, ranked });
      },
      *library_delete({ path: candidate }) {
        // The whole folder goes — report, annexures, thread — and the corpus unlearns it.
        const file = confined(dir(), candidate);
        if (file !== null && path.basename(file) === "report.md") { removeFolder(path.dirname(file)); yield* reindex(); }
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
      const settledAlready = warm && fs.existsSync(path.join(folder, "report.md"));
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
      reserved.delete(id);
      yield* reindex();
    },
  };
}
