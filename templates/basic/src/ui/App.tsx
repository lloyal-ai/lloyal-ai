/**
 * The shared React view — BOTH desktop and web mount this ONE component, and it
 * folds the SAME node-free `reduce` (`src/ui/state.ts`) that the cli's Ink view
 * does. Two runtimes (Ink · React), one `reduce`.
 *
 * It's styled as a Wikipedia article, because `basic` ships the `lloyal/wikipedia`
 * ability: a Contents rail, a serif title + editorial prose, the fetched articles
 * floated as captioned figures, and a collapsible agent log where each agent's
 * thinking and findings stream in. Swap the ability and the wiki-specific bits (source
 * figures) gracefully empty; the layout + the streaming log stay generic. This is
 * the floor — reskin it into your product's own look.
 *
 * It's transport-agnostic: it reads only `window.harness`, a bridge injected by
 * desktop's preload (IPC) or web's boot (`connectWss`).
 */
import "./app.css";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { DevPane } from "@lloyal-labs/dev-tools/react";
import { config } from "../config.js";
import { lastLine, slugify } from "../common/util.js";
import { APP } from "./presentation.js";
import { FRAMING } from "./devtools.js";
import {
  reduce,
  initialState,
  formatSize,
  isWikiAgent,
  isLiveAgent,
  reasoningOf,
  reportOf,
  shelf,
  type AppState,
  type AgentRuntime,
  type Shelf as ShelfGroup,
  type WikiSource,
} from "./state.js";
import { extractStreamingReport, hostOf } from "@lloyal-labs/ui/fold";
import { RIG_REPORT } from "@lloyal-labs/rig";
import { headingsOf } from "@lloyal-labs/ui/prose";
import { availabilityOf, connectProjection } from "@lloyal-labs/binding";
import type { Availability, SessionState, WireStatus } from "@lloyal-labs/binding";
import type { WorkflowEvent, Command } from "../protocol.js";
import { Markdown, StreamingMarkdown } from "./Markdown.js";

const scrollTo = (id: string): void =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** A fetched article as a Wikipedia-style figure, floated into the prose. */
function SourceFigure({ s }: { s: WikiSource }): ReactElement {
  return (
    <figure className="wiki-fig">
      {s.thumbnail && <img src={s.thumbnail} alt="" loading="lazy" />}
      <figcaption>
        <a href={s.url || undefined} target="_blank" rel="noopener noreferrer">
          {s.title}
        </a>
        {s.snippet && ` — ${s.snippet}`}
      </figcaption>
    </figure>
  );
}

/** The model's reasoning while it streams — a ticker, not the page. Collapsed by default: the newest line and
 *  how much has been thought, so a mind going in circles is visible as circles, not as an article. Expanded,
 *  the whole stream in a bounded box pinned to the newest line. Where the reasoning ends and the article
 *  begins is the fold's to know. */
function Thinking({ text }: { text: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lines = text.split("\n").filter((l) => l.trim());
  const last = lastLine(text);
  const words = text.split(/\s+/).filter(Boolean).length;
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, open]);
  return (
    <div className="wiki-agents-entry wiki-thinking">
      <div className="wiki-agents-head">
        <span className="wiki-dot wiki-dot--active" />
        <span className="wiki-agents-title">Thinking</span>
        <span className="wiki-agents-status">{words} words · {lines.length} lines</span>
        <button type="button" className="wiki-toggle" onClick={() => setOpen((o) => !o)}>
          [{open ? "hide" : "show"}]
        </button>
      </div>
      {!open ? (
        <div className="wiki-agents-preview">{last || "thinking…"}<span className="wiki-caret">▍</span></div>
      ) : (
        <div className="wiki-agents-body" ref={bodyRef}>
          <p className="wiki-agents-think">{text}<span className="wiki-caret">▍</span></p>
        </div>
      )}
    </div>
  );
}

/** One agent in the agent log: a collapsible row (Wikipedia [show]/[hide]).
 *  Collapsed shows a live one-line preview; expanded reveals the streaming
 *  thinking and, once the agent writes its terminal report, the findings — both
 *  in a bounded, scrollable box pinned to the newest line. */
function AgentEntry({ a }: { a: AgentRuntime }): ReactElement {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // The fold has already split the model's reasoning from its prose; the live report is the terminal call
  // as it is written, and the filed one replaces it the moment the agent returns.
  const reasoning = reasoningOf(a);
  const report =
    reportOf(a) ?? extractStreamingReport(a.contentBuffer, { tool: RIG_REPORT.tool, field: RIG_REPORT.field });
  const live = isLiveAgent(a);
  const preview = report !== null ? lastLine(report) || "writing report…" : lastLine(reasoning) || "thinking…";
  const status =
    a.phase === "done"
      ? "done"
      : a.phase === "failed"
        ? "failed"
        : report !== null
          ? "writing report"
          : "reading";
  // Keep the expanded box pinned to the newest line while it streams.
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [reasoning, report, open]);

  return (
    <div className="wiki-agents-entry">
      <div className="wiki-agents-head">
        <span className={`wiki-dot wiki-dot--${a.phase}`} />
        <span className="wiki-agents-title">Agent {a.label}</span>
        <span className="wiki-agents-status">{status}</span>
        <button type="button" className="wiki-toggle" onClick={() => setOpen((o) => !o)}>
          [{open ? "hide" : "show"}]
        </button>
      </div>
      {!open ? (
        <div className="wiki-agents-preview">{preview}</div>
      ) : (
        <div className="wiki-agents-body" ref={bodyRef}>
          {reasoning && (
            <p className="wiki-agents-think">
              {reasoning}
              {live && report === null && <span className="wiki-caret">▍</span>}
            </p>
          )}
          {report !== null && (
            <div className="wiki-agents-report">
              <div className="wiki-agents-report-label">Findings</div>
              <div className="md">
                {live ? <StreamingMarkdown text={report} /> : <Markdown text={report} />}
              </div>
              {live && <span className="wiki-caret">▍</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What is already on the shelf, on the landing. The heading appears only once the model has named a topic,
 * so the ungrouped list and the grouped one are the same markup — and CSS does the reflow when `key` order
 * changes, which is what makes the model's work visible without blocking a single frame on it.
 */
function Shelf({ groups }: { groups: ShelfGroup[] }): ReactElement | null {
  if (groups.length === 0) return null;
  return (
    <section className="wiki-shelf">
      <h2>Already here</h2>
      {groups.map((g, i) => (
        <div key={g.topic ?? `ungrouped-${i}`} className="wiki-shelf-group">
          {g.topic && <h3>{g.topic}</h3>}
          <ul>
            {g.articles.map((a) => (
              <li key={a.id}>
                {a.query}
                <span className="wiki-shelf-when"> — {a.savedAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * The wire and the session as ONE word the view can render. Both planes are
 * optional on a `Bridge`: the desktop's in-process link cannot drop, so it
 * reports no status — absence there means connected, not broken.
 */
function useAvailability(): Availability {
  const [wire, setWire] = useState<WireStatus>(
    window.harness.onStatus ? "connecting" : "connected",
  );
  const [session, setSession] = useState<SessionState | null>(null);
  useEffect(() => {
    const offs = [window.harness.onStatus?.(setWire), window.harness.onSession?.(setSession)];
    return () => {
      for (const off of offs) off?.();
    };
  }, []);
  return availabilityOf(session, wire);
}

/** What each availability means to a reader, in their terms — never the wire's. */
const WIRE_WORDS: Record<Availability, string> = {
  connecting: "connecting…",
  queued: "waiting for a free slot…",
  warming: "loading the model…",
  ready: "",
  ended: "this session ended.",
  lost: "the host is not up — retrying…",
};

export function HarnessApp({ surface }: { surface: string }): ReactElement {
  // The projection owns the fold: it seeds from the bridge's snapshot, holds
  // frames until that lands, and RE-SEEDS when the stream's `epoch` changes — a
  // reconnected socket, or a desktop engine replaced by `recover`. Comparing
  // `seq` alone (which this view used to do) silently drops the new stream's
  // frames, because a fresh stream restarts its numbering.
  const projection = useMemo(
    () => connectProjection<WorkflowEvent, Command, AppState>(window.harness, initialState, reduce),
    [],
  );
  useEffect(() => () => projection.dispose(), [projection]);
  const state = useSyncExternalStore(projection.subscribe, projection.getSnapshot);
  const availability = useAvailability();
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");

  const submit = (): void => {
    const q = query.trim();
    if (!q) return;
    window.harness.send({ type: "submit_query", query: q });
    setTopic(q);
    setQuery("");
  };

  // The roster holds THIS turn's agents, so the settling agent is simply the one working no angle.
  const agents: AgentRuntime[] = [...state.roster.agents.values()];
  const readers = agents.filter(isWikiAgent);
  const synth = agents.find((a) => a.timeline !== null && !isWikiAgent(a));
  const live = readers.filter(isLiveAgent);
  const plural = (n: number): string => (n === 1 ? "" : "s");
  const readersNote =
    live.length > 0
      ? `${live.length} agent${plural(live.length)} reading Wikipedia in parallel.`
      : `${readers.length} agent${plural(readers.length)} read Wikipedia for this page.`;
  const sources = state.sources;
  const working = state.phase === "working";
  // The browser tab mirrors run state — a dot while working, like an unread badge.
  useEffect(() => {
    document.title = working ? `● ${APP.name}` : APP.name;
  }, [working]);
  // The article: the settled answer, then what the settling agent filed, then its prose as it arrives. The
  // middle one is not redundant — when the agent returns, the fold moves its prose out of `contentBuffer` and
  // files it, so reading only the buffer blanks the page for as long as the trunk takes to accept the article.
  // The fold has already separated prose from reasoning, so there is no marker to look for here.
  const report = state.answer || (synth && reportOf(synth)) || synth?.contentBuffer.trim() || "";
  // Before it starts writing, show its reasoning streaming so the pane is alive, not a static spinner.
  const synthThinking = synth && !report ? reasoningOf(synth) : "";
  // The Contents, from the SAME rendered heading text the renderer assigns ids from
  // (`headingsOf` reads the render grammar), so a link and its target cannot disagree.
  const headings = report
    ? headingsOf(report)
        .filter((h) => h.depth === 2 || h.depth === 3)
        .map((h) => ({ text: h.text, level: h.depth, slug: slugify(h.text) }))
    : [];
  // `state.topic` is authoritative (it survives a reload and is the same on
  // every surface); the local one only covers the instant before `query` lands.
  const title = state.topic || topic || APP.name;

  // The dev shell: the wiki view lives in the shell's scroll container and the pane docks below it, only when
  // the wire said dev. The config table gives the Settings tab its tiers and each key's words; no key of this
  // app's offers a choice below boot, so nothing there sends a command — when one does, the loop serves it.
  return (
    <DevPane bridge={window.harness} config={config} framing={FRAMING} title={APP.name}>
      <div className="wiki">
        <header className="wiki-top">
          <div className="wiki-brand">
            <span className="wiki-brand-name">{APP.name}</span>
            <span className="wiki-brand-sub">
              {state.boot
                ? `${state.boot.model.id} · ${formatSize(state.boot.model.sizeBytes)} · ${surface}`
                : state.phase}
              {state.kv.total > 0 && ` · kv ${Math.round((100 * state.kv.used) / state.kv.total)}%`}
            </span>
          </div>
          {availability !== "ready" && availability !== "connecting" && (
            <span className="wiki-wire" role="status">
              {WIRE_WORDS[availability]}
              {availability === "ended" && window.harness.recover && (
                <button type="button" onClick={() => window.harness.recover?.()}>
                  start a new session
                </button>
              )}
            </span>
          )}
          <form
            className="wiki-search"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Wikipedia…"
              disabled={working}
            />
            <button type="submit" disabled={working || !query.trim()}>
              {working ? "Reading…" : "Ask"}
            </button>
          </form>
        </header>

        <div className="wiki-cols">
          <nav className="wiki-toc" aria-label="Contents">
            <div className="wiki-toc-head">Contents</div>
            <ul>
              <li>
                <button type="button" onClick={() => scrollTo("top")}>
                  (Top)
                </button>
              </li>
              {headings.map((h, i) => (
                <li key={i} className={`wiki-toc-l${h.level}`}>
                  <button type="button" onClick={() => scrollTo(h.slug)}>
                    {h.text}
                  </button>
                </li>
              ))}
              {readers.length > 0 && (
                <li>
                  <button type="button" onClick={() => scrollTo("agents")}>
                    Agents
                  </button>
                </li>
              )}
              {sources.length > 0 && (
                <li>
                  <button type="button" onClick={() => scrollTo("sources")}>
                    Sources
                  </button>
                </li>
              )}
            </ul>
          </nav>

          <main className="wiki-article" id="top">
            <h1 className="wiki-title">{title}</h1>
            <hr className="wiki-rule" />

            {/* Fetched articles as a Wikipedia-style image gallery — a wrapping
                grid of uniform cards, so they read as a gallery, not a stack. */}
            {sources.length > 0 && (
              <div className="wiki-figs">
                {sources.map((s) => (
                  <SourceFigure key={s.url || s.title} s={s} />
                ))}
              </div>
            )}

            {report ? (
              <div className="wiki-prose md">
                {state.answer ? <Markdown text={report} /> : <StreamingMarkdown text={report} />}
              </div>
            ) : synth ? (
              <div>
                <p className="wiki-lead">Writing the report…</p>
                {synthThinking && <Thinking text={synthThinking} />}
              </div>
            ) : working ? (
              <p className="wiki-lead">Reading Wikipedia… The article will appear here.</p>
            ) : (
              <>
                <p className="wiki-lead">Ask a question above to build an article from Wikipedia.</p>
                <Shelf groups={shelf(state)} />
              </>
            )}

            {state.nothingFound && (
              <p className="wiki-lead">
                Nothing found on Wikipedia for that. Try naming the subject more directly.
              </p>
            )}

            {state.error && <p className="wiki-error">Error: {state.error}</p>}

            {readers.length > 0 && (
              <section id="agents" className="wiki-agents">
                <h2>Agents</h2>
                <p className="wiki-agents-note">
                  {readersNote} Expand an agent to follow its reasoning and findings.
                </p>
                {readers.map((a) => (
                  <AgentEntry key={a.id} a={a} />
                ))}
              </section>
            )}

            {sources.length > 0 && (
              <section id="sources" className="wiki-refs">
                <h2>Sources</h2>
                <ol>
                  {sources.map((s, i) => (
                    <li key={i}>
                      <a href={s.url || undefined} target="_blank" rel="noopener noreferrer">
                        {s.title}
                      </a>
                      {s.url && <span className="wiki-refs-host"> — {hostOf(s.url)}</span>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </main>
        </div>
      </div>
    </DevPane>
  );
}
