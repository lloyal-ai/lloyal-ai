/**
 * The shared React view — BOTH desktop and web mount this ONE component, and it
 * folds the SAME node-free `reduce` (`harness/state.ts`) that the cli's Ink view
 * does. Two runtimes (Ink · React), one `reduce`, one rich research `AppState`.
 *
 * It is transport-agnostic: it only reads `window.harness` — a bridge injected
 * by desktop's preload (contextBridge over IPC) or web's boot (`connectWss` over
 * a socket). It renders the run the way the reference app does: the asked
 * question, the plan with live per-task status, one card per research agent
 * streaming its thought / tool work / report as it happens, and the synthesized
 * answer as markdown. Everything shown is already in `AppState` — this file is
 * only a renderer, and it is YOURS: grow it into your product's UI (or bring
 * your own app); the harness never changes.
 *
 * SNAPSHOT: reasoning.run @ 0.8.0 (view: the desktop renderer's card grammar)
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DevPane } from "@lloyal-labs/dev-tools/react";
import type { DevControl } from "@lloyal-labs/dev-tools";
import {
  reduce, initialState, extractStreamingReport,
  type AppState, type AgentRuntime, type TimelineItem,
} from "../../harness/state.js";
import type { WorkflowEvent, Command } from "../../harness/protocol.js";

declare global {
  interface Window {
    harness: {
      onEvent(cb: (frame: { seq: number; ev: WorkflowEvent }) => void): () => void;
      send(command: Command): void;
      requestSnapshot(): Promise<{ state: AppState; seq: number }>;
    };
  }
}

/**
 * This harness's dev-pane Settings contribution — pure DATA. Each row becomes
 * a segmented control that dispatches the SAME command the composer already
 * sends; the pane itself ships in `@lloyal-labs/dev-tools` and renders only
 * under `LLOYAL_DEV=1` (the `config:loaded.dev` gate).
 */
const DEV_CONTROLS: readonly DevControl[] = [
  {
    key: "defaults.effort",
    values: ["low", "medium", "high", "ultra"],
    command: "set_effort",
    field: "effort",
    note: "applies next run",
    read: (c) => (c.defaults as { effort?: string } | undefined)?.effort,
  },
  {
    key: "defaults.reasoningMode",
    originKey: "reasoningMode",
    values: ["flat", "deep"],
    command: "change_mode",
    field: "mode",
    note: "applies next run",
    read: (c) => (c.defaults as { reasoningMode?: string } | undefined)?.reasoningMode,
  },
];

/** Where the input line is offered — the harness is idle and awaiting a query. */
const CAN_INPUT = new Set<AppState["uiPhase"]>(["boot", "composer", "done", "clarifying"]);

// Per-agent accent colors, assigned by task index — the same idea as the
// reference app's --a1..--a5.
const AGENT_COLORS = ["#669df6", "#7ee2a8", "#e3c04a", "#e28aa8", "#9aa7ff"];
const agentColor = (i: number): string => AGENT_COLORS[((i % AGENT_COLORS.length) + AGENT_COLORS.length) % AGENT_COLORS.length];

/** Compact elapsed: "8s", "45s", "2m 10s". Empty for a non-finite input. */
function fmtElapsed(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Re-render every second while `active`, so live elapsed timers tick even
 *  when no token stream drives a render (e.g. every agent parked on a tool). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Extracts the report markdown from a `report` item's body — it MAY be raw
 * markdown OR the report-tool's JSON argument `{"result":"## …"}`; unwrap
 * `.result` only when parsing yields exactly that shape.
 */
function extractReportBody(body: string): string {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as { result?: unknown };
      if (parsed && typeof parsed === "object" && typeof parsed.result === "string") return parsed.result;
    } catch { /* not JSON — raw markdown */ }
  }
  return body;
}

function toolVerb(tool: string, done: boolean): string {
  if (/search/i.test(tool)) return done ? "Searched" : "Searching";
  return done ? "Read" : "Reading";
}

function resultMeta(r: Extract<TimelineItem, { kind: "tool_result" }>): string {
  const head = r.resultCount != null ? `${r.resultCount} results` : `${(r.byteLength / 1000).toFixed(1)} kb`;
  const hosts = r.hosts.slice(0, 2).join(" · ");
  return hosts ? `${head} · ${hosts}` : head;
}

const md = (text: string): ReactElement => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer">{children}</a>
      ),
    }}
  >
    {text}
  </ReactMarkdown>
);

// ── work rows: an agent's chronological stream ───────────────────

/** A think row — collapsed by default (bodies can be huge); auto-open only
 *  while live AND short, without clobbering an explicit user toggle. */
function ThinkRow({ it }: { it: Extract<TimelineItem, { kind: "think" }> }): ReactElement {
  const autoOpen = it.live && it.body.length < 280;
  const [open, setOpen] = useState(autoOpen);
  const prevAuto = useRef(autoOpen);
  useEffect(() => {
    if (autoOpen !== prevAuto.current) {
      setOpen(autoOpen);
      prevAuto.current = autoOpen;
    }
  }, [autoOpen]);
  return (
    <div style={S.wrow}>
      <button type="button" style={S.wtoggle} onClick={() => setOpen((o) => !o)}>
        <span style={{ opacity: 0.75 }}>{it.live ? "Thinking" : "Thought"}</span>
        <span style={S.chev}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={S.think}>
          {it.body}
          {it.live && <span className="rr-caret" />}
        </div>
      )}
    </div>
  );
}

function ReportRow({ body, tokenCount }: { body: string; tokenCount: number }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div style={S.wrow}>
      <button type="button" style={S.wtoggle} onClick={() => setOpen((o) => !o)}>
        <span style={{ opacity: 0.9 }}>✓ Report</span>
        <span style={S.metaInline}>{tokenCount.toLocaleString()} tok</span>
        <span style={S.chev}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div style={S.reportBody}>{md(extractReportBody(body))}</div>}
    </div>
  );
}

function WorkRows({ a, now }: { a: AgentRuntime; now: number }): ReactElement {
  const rows: ReactElement[] = [];
  for (const it of a.timeline) {
    if (it.kind === "think") rows.push(<ThinkRow key={`t${it.id}`} it={it} />);
    else if (it.kind === "tool_call") {
      // Pair the call with its result (callId back-reference) so the verb and
      // its "N results · host" meta render as one row.
      const result = a.timeline.find(
        (r): r is Extract<TimelineItem, { kind: "tool_result" }> =>
          r.kind === "tool_result" && r.callId === it.id,
      );
      rows.push(
        <div key={`c${it.id}`} style={S.wrow}>
          <div style={S.toolRow}>
            <span style={{ opacity: 0.9 }}>{toolVerb(it.tool, !!result)}</span>
            <span style={S.toolArgs}>{it.argsSummary}</span>
            {result && <span style={S.metaInline}>{resultMeta(result)}</span>}
            {!result && a.retry === null && <span className="rr-spin" />}
          </div>
        </div>,
      );
    } else if (it.kind === "report") {
      rows.push(<ReportRow key={`r${it.id}`} body={it.body} tokenCount={it.tokenCount} />);
    }
  }

  // The park, narrated: the provider rate-limited and the pool will quietly
  // re-execute — a waiting agent must never read as hung.
  if (a.retry) {
    const left = Math.max(0, Math.ceil((a.retry.retryAt - now) / 1000));
    rows.push(
      <div key="retry" style={{ ...S.wrow, color: "#e3c04a" }}>
        {a.retry.tool} rate-limited — {left > 0 ? `retrying in ~${left}s` : "retrying…"}
        {a.retry.attempt > 1 ? ` (attempt ${a.retry.attempt})` : ""}
      </div>,
    );
  }

  // Live "Writing report" — the model is streaming the terminal report body
  // (voluntary: between the report tool's markers; recovery: raw prose).
  const streaming = a.recovering ? a.contentBuffer : extractStreamingReport(a.contentBuffer);
  if (streaming && a.phase !== "done") {
    rows.push(
      <div key="writing" style={S.wrow}>
        <div style={{ opacity: 0.75, marginBottom: 3 }}>Writing report</div>
        <div style={S.think}>
          …{streaming.slice(-400)}
          <span className="rr-caret" />
        </div>
      </div>,
    );
  }

  if (a.failReason) {
    rows.push(
      <div key="fail" style={{ ...S.wrow, color: "#ff7a7a" }}>
        ✗ {a.failReason}
      </div>,
    );
  }
  return <>{rows}</>;
}

/** One research agent: colored accent, header (task · elapsed · tok), and a
 *  CLAMPED, tail-following work stream — the card's height is stable while
 *  the agent runs, so parallel columns never push each other around. A
 *  finished agent collapses to its header (click to re-open) — the
 *  reference app's rule: live cards never collapse mid-stream, done cards do. */
function AgentCard({ a, now }: { a: AgentRuntime; now: number }): ReactElement {
  const color = agentColor(a.taskIndex ?? 0);
  const elapsed = Number.isFinite(a.startedAt) ? (a.endedAt ?? now) - a.startedAt : NaN;
  const terminal = a.phase === "done" || a.phase === "failed";
  const [expanded, setExpanded] = useState(false);
  const showBody = terminal ? expanded : true;

  // Pin the work stream to its own tail while live — each column follows its
  // agent like a terminal; the page never scrolls on its behalf.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!terminal && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  });

  return (
    <div style={{ ...S.card, borderLeft: `3px solid ${color}`, opacity: terminal && !expanded ? 0.72 : 1, margin: 0 }}>
      <div
        style={{ ...S.cardHead, cursor: terminal ? "pointer" : "default" }}
        onClick={terminal ? () => setExpanded((e) => !e) : undefined}
        title={terminal ? (expanded ? "collapse" : "expand") : undefined}
      >
        <span style={{ color, fontWeight: 600 }}>{a.label}</span>
        {a.taskDescription && <span style={S.cardTask}>{a.taskDescription}</span>}
        <span style={S.cardMeta}>
          {a.phase === "failed" ? "✗ " : a.phase === "done" ? "✓ " : ""}
          {fmtElapsed(elapsed)} · {a.tokenCount.toLocaleString()} tok
          {a.toolCallCount > 0 ? ` · ${a.toolCallCount} tools` : ""}
          {terminal && <span style={{ marginLeft: 6, opacity: 0.6 }}>{expanded ? "▾" : "▸"}</span>}
        </span>
      </div>
      {showBody && (
        <div ref={bodyRef} style={terminal ? undefined : S.cardBody}>
          <WorkRows a={a} now={now} />
        </div>
      )}
    </div>
  );
}

// ── the plan card: tasks with live status ────────────────────────

type TaskStatus = "pending" | "running" | "paused" | "done" | "failed";

function agentForTask(s: AppState, taskIndex: number): AgentRuntime | null {
  for (const a of s.agents.values()) if (a.taskIndex === taskIndex) return a;
  for (const it of s.scrollback) {
    if (it.kind === "agent" && it.agent.taskIndex === taskIndex) return it.agent;
  }
  return null;
}

/** Pool-level: while any agent is in a tool dispatch the pool holds, so a
 *  "running" spinner would lie — render paused instead. */
function poolDispatching(s: AppState): boolean {
  for (const a of s.agents.values()) {
    if (a.taskIndex !== null && (a.phase === "tool" || a.pendingToolCallId !== null)) return true;
  }
  return false;
}

function taskStatus(s: AppState, taskIndex: number, dispatching: boolean): { status: TaskStatus; agent: AgentRuntime | null } {
  const agent = agentForTask(s, taskIndex);
  if (!agent) return { status: "pending", agent: null };
  if (agent.phase === "done") return { status: "done", agent };
  if (agent.phase === "failed") return { status: "failed", agent };
  return { status: dispatching ? "paused" : "running", agent };
}

function StatusGlyph({ status, color }: { status: TaskStatus; color: string }): ReactElement {
  const c = status === "failed" ? "#ff7a7a" : color;
  return (
    <span style={{ color: c, width: 16, display: "inline-flex", justifyContent: "center" }}>
      {status === "pending" && <span style={S.ring} />}
      {status === "running" && <span className="rr-spin" style={{ borderTopColor: c }} />}
      {status === "paused" && "❚❚"}
      {status === "done" && "✓"}
      {status === "failed" && "✗"}
    </span>
  );
}

function PlanCard({ s }: { s: AppState }): ReactElement | null {
  const tasks = s.plan?.tasks;
  if (!tasks || tasks.length === 0) return null;
  const dispatching = poolDispatching(s);
  const anyLive = [...s.agents.values()].some((a) => a.taskIndex !== null && a.endedAt === null);
  const now = useNow(anyLive);
  return (
    <div style={S.card}>
      <div style={S.planHead}>Plan · {tasks.length} tasks</div>
      {tasks.map((t, i) => {
        const { status, agent } = taskStatus(s, i, dispatching);
        const elapsed = agent && Number.isFinite(agent.startedAt) ? (agent.endedAt ?? now) - agent.startedAt : null;
        return (
          <div key={i} style={S.planRow}>
            <span style={{ ...S.planN, color: agentColor(i) }}>{i + 1}</span>
            <span style={S.planDesc}>{t.description}</span>
            {elapsed != null && <span style={S.metaInline}>{fmtElapsed(elapsed)}</span>}
            <StatusGlyph status={status} color={agentColor(i)} />
          </div>
        );
      })}
    </div>
  );
}

// ── the app ──────────────────────────────────────────────────────

export function HarnessApp() {
  const [state, setState] = useState<AppState>(initialState);
  const seqRef = useRef(-1);
  const [query, setQuery] = useState("");
  const acceptedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let seeded = false;
    // Subscribe FIRST so no frame is missed, but hold frames until the snapshot
    // lands — applying them live would let a frame advance `seqRef` and then be
    // overwritten by an older snapshot cut (a lost-event gap on reload).
    const pending: { seq: number; ev: WorkflowEvent }[] = [];
    const apply = (frame: { seq: number; ev: WorkflowEvent }): void => {
      if (frame.seq <= seqRef.current) return;
      seqRef.current = frame.seq;
      setState((s) => reduce(s, frame.ev));
    };
    // Seed from `base`@`baseSeq`, then fold any buffered frames newer than the cut
    // — computed OUTSIDE the updater so React StrictMode's double-invoke is safe.
    const seed = (base: AppState, baseSeq: number): void => {
      if (!alive || seeded) return;
      let next = base;
      let cur = baseSeq;
      for (const f of pending) {
        if (f.seq <= cur) continue;
        cur = f.seq;
        next = reduce(next, f.ev);
      }
      pending.length = 0;
      seqRef.current = cur;
      seeded = true;
      setState(next);
    };
    const off = window.harness.onEvent((frame) => {
      if (seeded) apply(frame);
      else pending.push(frame);
    });
    window.harness
      .requestSnapshot()
      .then((snap) => seed(snap.state, snap.seq))
      // No snapshot (e.g. the host is unreachable): seed from the initial state so
      // the stream is never stuck buffering, and replay whatever we've buffered.
      .catch(() => seed(initialState, -1));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Auto-accept the planner's plan — this view has no plan-review editor, so a
  // query flows straight through to research. `acceptedRef` de-bounces the one
  // transition into `plan_review` (mirrors the cli view).
  useEffect(() => {
    if (state.uiPhase === "plan_review" && !acceptedRef.current) {
      acceptedRef.current = true;
      window.harness.send({ type: "accept_plan" });
    }
    if (state.uiPhase !== "plan_review") acceptedRef.current = false;
  }, [state.uiPhase]);

  const submit = (): void => {
    const q = query.trim();
    if (!q) return;
    if (state.uiPhase === "clarifying") {
      window.harness.send({ type: "submit_clarification", answer: q });
    } else {
      // The run mode comes from the loaded config default (`config:loaded`
      // seeds `state.config`); this view has no mode toggle.
      window.harness.send({
        type: "submit_query",
        query: q,
        mode: state.config?.defaults.reasoningMode ?? "flat",
      });
    }
    setQuery("");
  };

  // Live research agents (skip the tool-less synth agent — taskIndex null),
  // plus finished snapshots from scrollback so completed work stays visible.
  const liveAgents: AgentRuntime[] = [...state.agents.values()].filter((a) => a.taskIndex !== null);
  const anyLive = liveAgents.some((a) => a.endedAt === null);
  const now = useNow(anyLive);

  // The streaming answer: the live synth buffer, else the finalized answer, else
  // the most recent synth body pushed to scrollback.
  const lastSynth = [...state.scrollback].reverse().find((s) => s.kind === "synth");
  const synthLive = state.synth.open && state.synth.buffer;
  const answer =
    state.answer || (lastSynth && lastSynth.kind === "synth" ? lastSynth.body : "");

  const kvPct =
    state.pressure && state.pressure.nCtx > 0
      ? Math.min(100, Math.round((100 * state.pressure.cellsUsed) / state.pressure.nCtx))
      : null;

  const canInput = CAN_INPUT.has(state.uiPhase);

  return (
    <div style={S.page}>
      {/* keyframes for the caret + spinner — one style tag, no assets */}
      <style>{`
        .rr-caret { display:inline-block; width:7px; height:14px; background:#cfe6ff; margin-left:2px; vertical-align:-2px; animation: rrblink 1s steps(2) infinite; }
        .rr-spin { display:inline-block; width:11px; height:11px; border:2px solid #2b3140; border-top-color:#669df6; border-radius:50%; animation: rrspin .8s linear infinite; }
        @keyframes rrblink { 50% { opacity: 0; } }
        @keyframes rrspin { to { transform: rotate(360deg); } }
        a { color: #8ab4f8; }
      `}</style>

      <div style={S.head}>
        __NAME__ · {state.phase}
        {state.uiPhase !== state.phase ? ` · ${state.uiPhase}` : ""}
        {kvPct !== null && ` · kv ${kvPct}%`}
      </div>

      {state.query && (
        <div style={S.qcard}>{state.query}</div>
      )}

      <PlanCard s={state} />

      {state.uiPhase === "clarifying" && state.plan?.clarifyQuestions?.length ? (
        <div style={S.clarify}>
          <div style={{ marginBottom: 4, fontWeight: 600 }}>The planner needs to clarify:</div>
          {state.plan.clarifyQuestions.map((q, i) => (
            <div key={i}>{i + 1}. {q}</div>
          ))}
        </div>
      ) : null}

      {liveAgents.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              liveAgents.length > 1 ? "repeat(auto-fit, minmax(340px, 1fr))" : "1fr",
            gap: 10,
            alignItems: "start",
            margin: "10px 0",
          }}
        >
          {liveAgents.map((a) => (
            <AgentCard key={a.id} a={a} now={now} />
          ))}
        </div>
      )}

      {synthLive ? (
        <div style={S.card}>
          <div style={{ opacity: 0.75, marginBottom: 6 }}>Writing answer</div>
          <div style={S.answerMd}>
            {md(state.synth.buffer)}
            <span className="rr-caret" />
          </div>
        </div>
      ) : answer ? (
        <div style={S.card}>
          <div style={S.answerMd}>{md(answer)}</div>
        </div>
      ) : null}

      {state.bootError && (
        <div style={S.error}>
          boot error ({state.bootError.kind}): {state.bootError.message}
        </div>
      )}
      {state.toast?.tone === "error" && <div style={S.error}>error: {state.toast.message}</div>}

      {canInput && (
        <div style={S.composer}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder={
              state.uiPhase === "clarifying" ? "Answer the planner…" : "Ask something…"
            }
            style={S.input}
          />
          <button type="button" onClick={submit} style={S.send}>
            Send
          </button>
        </div>
      )}
      <DevPane bridge={window.harness} controls={DEV_CONTROLS} title="__NAME__" />
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  page: { font: "14px/1.55 ui-sans-serif, system-ui, sans-serif", color: "#e6e9ef", padding: "18px 28px 28px" },
  head: { opacity: 0.55, fontSize: 12, marginBottom: 14, letterSpacing: 0.3 },
  qcard: { fontSize: 19, fontWeight: 600, lineHeight: 1.4, margin: "4px 0 14px" },
  card: { background: "#11141b", border: "1px solid #222836", borderRadius: 10, padding: "12px 14px", margin: "10px 0" },
  cardHead: { display: "flex", alignItems: "baseline", gap: 8, fontSize: 13, marginBottom: 6 },
  cardBody: { maxHeight: "max(340px, 42vh)", overflowY: "auto", overscrollBehavior: "contain" },
  cardTask: { opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  cardMeta: { opacity: 0.5, fontSize: 12, whiteSpace: "nowrap" },
  wrow: { padding: "4px 0 4px 2px", fontSize: 13, borderTop: "1px solid #1a1f2b" },
  wtoggle: { display: "flex", alignItems: "center", gap: 6, background: "none", border: 0, color: "inherit", font: "inherit", cursor: "pointer", padding: 0 },
  chev: { opacity: 0.45, fontSize: 10 },
  metaInline: { opacity: 0.5, fontSize: 12, marginLeft: 8, whiteSpace: "nowrap" },
  think: { whiteSpace: "pre-wrap", opacity: 0.62, fontSize: 12.5, lineHeight: 1.55, marginTop: 4, maxHeight: 180, overflowY: "auto" },
  reportBody: { marginTop: 6, maxHeight: 300, overflowY: "auto", fontSize: 13, lineHeight: 1.6 },
  toolRow: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 },
  toolArgs: { opacity: 0.6, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  planHead: { opacity: 0.75, fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8 },
  planRow: { display: "flex", alignItems: "baseline", gap: 10, padding: "5px 0", borderTop: "1px solid #1a1f2b", fontSize: 13.5 },
  planN: { fontWeight: 700, width: 14, textAlign: "right" },
  planDesc: { flex: 1, lineHeight: 1.45 },
  ring: { display: "inline-block", width: 9, height: 9, borderRadius: "50%", border: "2px solid #3a4358" },
  clarify: { margin: "10px 0", color: "#e3c04a" },
  answerMd: { lineHeight: 1.65, color: "#dfe7f3", fontSize: 14.5, maxWidth: "100ch" },
  error: { marginTop: 16, color: "#ff7a7a" },
  composer: { display: "flex", gap: 8, marginTop: 22 },
  input: { flex: 1, padding: "9px 12px", background: "#12151c", color: "#e6e9ef", border: "1px solid #2b3140", borderRadius: 8, outline: "none" },
  send: { padding: "9px 18px", background: "#3b4a6b", color: "#fff", border: 0, borderRadius: 8, cursor: "pointer" },
};
