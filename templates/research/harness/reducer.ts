/**
 * Pure event → AppState reducer.
 *
 * Owns: phase transitions, per-agent state machine (<think> boundary
 * detection), timeline item accrual (think / tool_call / tool_result /
 * report), synth buffer.
 *
 * Emits no side effects. Feed it a trace of StepEvent + AgentEvent; it
 * returns the view-ready state.
 */

import type {
  AppState, SessionState, DocState, DocId, AgentRuntime, TimelineItem,
  SourceMeta, SynthState,
} from './state-core.js';
import type { WorkflowEvent } from './events.js';
import type { Config } from './config-types.js';
import { shortPath } from './short-path.js';

/** Seed/refresh `participation` from current config. The reducer holds NO
 *  per-ability knowledge: abilities default to included via the `!== false`
 *  convention (any ability absent from the map renders as included), so there's
 *  nothing to seed here on a plain config load. The included-by-default set
 *  is the registry-enabled abilities surfaced via `abilities:state`; per-ability intent is
 *  driven explicitly through `participation:toggled` (chip toggle) and
 *  `set_ability_config` (configuring → main.ts sets the bit + re-emits state).
 *  Returns `prev` unchanged — kept as a function so config events have a
 *  single, named place to hook future participation policy. */
function seedParticipation(
  prev: Record<string, boolean>,
  _cfg: Config,
): Record<string, boolean> {
  return prev;
}

const THINK_CLOSE = '</think>';

/** First meaningful line of a think-block body, cleaned up for a title. */
function extractTitle(body: string): string {
  const text = body
    .replace(/^\s*\n/, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/, '')
    .trim();
  if (!text) return 'Thinking…';
  const firstLine = text.split('\n')[0].trim();
  const clipped = firstLine.length > 72 ? firstLine.slice(0, 72).trimEnd() + '…' : firstLine;
  return clipped;
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Best-effort argsSummary for tool_call rendering. One-liners per tool. */
function formatArgSummary(tool: string, rawArgs: string): string {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(rawArgs); } catch { parsed = {}; }
  const q = typeof parsed.query === 'string' ? parsed.query
    : typeof parsed.pattern === 'string' ? parsed.pattern
    : typeof parsed.url === 'string' ? parsed.url
    : typeof parsed.filename === 'string' ? parsed.filename
    : '';
  return q ? `"${q.length > 48 ? q.slice(0, 48) + '…' : q}"` : '';
}

/** Best-effort per-tool summary used by the column's ToolResult line. The
 *  `sources` field carries per-page citation metadata for the Sources ledger —
 *  extracted consumer-side from the tool's free-form result (the Ability Protocol
 *  prescribes no result schema). web_search/fetch_page already return
 *  url+title+snippet; image/icon (og:image + favicon) populate once the web ability
 *  ≥1.2.0 emits them. */
function summarizeResult(tool: string, raw: string): {
  summary: string;
  hosts: string[];
  resultCount: number | null;
  preview: string | null;
  sources?: SourceMeta[];
} {
  // Try JSON parse first — structured tools (web_search, search, grep, plan).
  try {
    const parsed: unknown = JSON.parse(raw);
    if (tool === 'web_search' && Array.isArray(parsed)) {
      const items = parsed as {
        url?: string;
        title?: string;
        snippet?: string;
        image?: string;
        icon?: string;
      }[];
      const hosts = Array.from(
        new Set(items.map((i) => (i.url ? hostOf(i.url) : '')).filter(Boolean)),
      ).slice(0, 3);
      // Per-page citations (url+title+snippet are already returned; image/icon
      // arrive with web ≥1.2.0). Cap to keep the envelope small.
      const sources: SourceMeta[] = items
        .filter((i) => i.url || i.title)
        .slice(0, 8)
        .map((i) => ({
          url: i.url,
          title: i.title,
          snippet: i.snippet,
          image: i.image,
          icon: i.icon,
          host: i.url ? hostOf(i.url) : undefined,
        }));
      return {
        summary: `${items.length} results`,
        hosts,
        resultCount: items.length,
        preview: items[0]?.title ?? null,
        sources: sources.length ? sources : undefined,
      };
    }
    // Corpus semantic search → { hits: [{ file, heading, score }], … }. Each hit
    // is a local source (a file/section); emit per-hit metadata into `sources`
    // so the ledger surfaces corpus sources exactly like web pages. The ledger
    // is Ability-Protocol-agnostic — it keys off `sources[]`, not the ability/tool name.
    if (
      tool === 'search' &&
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { hits?: unknown }).hits)
    ) {
      const hits = (parsed as { hits: { file?: string; heading?: string }[] }).hits;
      const sources: SourceMeta[] = hits
        .slice(0, 8)
        .map((h) => ({ title: h.heading || h.file, host: h.file }))
        .filter((s) => s.title || s.host);
      return {
        summary: `${hits.length} results`,
        hosts: [],
        resultCount: hits.length,
        preview: hits[0]?.heading ?? hits[0]?.file ?? null,
        sources: sources.length ? sources : undefined,
      };
    }
    // Corpus grep → { totalMatches, matches: [{ file, line, text }] }. One local
    // source per matching file, the matched line as the snippet.
    if (tool === 'grep' && typeof parsed === 'object' && parsed !== null) {
      const r = parsed as {
        totalMatches?: number;
        matches?: { file?: string; line?: number; text?: string }[];
      };
      const matches = r.matches ?? [];
      const sources: SourceMeta[] = matches
        .slice(0, 8)
        .map((m) => ({
          title: m.file,
          host: m.line != null ? `line ${m.line}` : undefined,
          snippet: m.text,
        }))
        .filter((s) => s.title);
      return {
        summary: `${r.totalMatches ?? 0} matches`,
        hosts: [],
        resultCount: r.totalMatches ?? null,
        preview: matches[0]?.file ?? null,
        sources: sources.length ? sources : undefined,
      };
    }
    // Corpus read_file → { file, content, lines } (or { file, note }). The agent
    // opened this file: one local source, marked via the fetch-tool name so the
    // ledger tiers it as "featured" (read closely) rather than merely surveyed.
    if (tool === 'read_file' && typeof parsed === 'object' && parsed !== null) {
      const r = parsed as { file?: string; error?: string };
      if (r.error) return { summary: r.error, hosts: [], resultCount: null, preview: null };
      const sources: SourceMeta[] = r.file ? [{ title: r.file }] : [];
      return {
        summary: `${raw.length}b`,
        hosts: [],
        resultCount: null,
        preview: r.file ?? null,
        sources: sources.length ? sources : undefined,
      };
    }
    if (
      (tool === 'fetch_page' || tool === 'web_fetch') &&
      typeof parsed === 'object' &&
      parsed !== null
    ) {
      const r = parsed as {
        url?: string;
        title?: string;
        error?: string;
        excerpt?: string;
        image?: string;
        icon?: string;
      };
      if (r.error) return { summary: r.error, hosts: [], resultCount: null, preview: null };
      const hosts = r.url ? [hostOf(r.url)] : [];
      // A fetched page is one rich citation: title + excerpt as the snippet,
      // plus og:image + favicon once the web ability emits them (web ≥1.2.0).
      const sources: SourceMeta[] | undefined =
        r.url || r.title
          ? [
              {
                url: r.url,
                title: r.title,
                snippet: r.excerpt,
                image: r.image,
                icon: r.icon,
                host: r.url ? hostOf(r.url) : undefined,
              },
            ]
          : undefined;
      return {
        summary: `${raw.length}b`,
        hosts,
        resultCount: null,
        preview: r.title ?? null,
        sources,
      };
    }
  } catch {
    /* fall through to URL-scan fallback */
  }

  // Fallback: scrape hosts from raw URLs in the result payload.
  const urls = Array.from(raw.matchAll(/https?:\/\/[^\s\])>"]+/g)).map((m) => m[0]);
  if (urls.length > 0) {
    const hosts = Array.from(new Set(urls.map(hostOf))).slice(0, 3);
    return {
      summary: `${urls.length} links`,
      hosts,
      resultCount: urls.length,
      preview: null,
    };
  }

  return { summary: `${raw.length}b`, hosts: [], resultCount: null, preview: null };
}

// ── Immutable-update helpers ────────────────────────────────────

function replaceAgent(
  doc: DocState,
  id: number,
  patch: (a: AgentRuntime) => AgentRuntime,
): DocState {
  const existing = doc.agents.get(id);
  if (!existing) return doc;
  const agents = new Map(doc.agents);
  agents.set(id, patch(existing));
  return { ...doc, agents };
}

function createAgent(doc: DocState, id: number, patch: Partial<AgentRuntime> = {}): DocState {
  if (doc.agents.has(id)) return doc;
  const base: AgentRuntime = {
    id,
    label: `A${doc.nextLabelIdx}`,
    phase: 'idle',
    startedAt: Date.now(),
    endedAt: null,
    tokenCount: 0,
    toolCallCount: 0,
    taskIndex: null,
    taskDescription: null,
    dependencyHint: null,
    currentThinkId: null,
    pendingToolCallId: null,
    retry: null,
    contentBuffer: '',
    recovering: false,
    failReason: null,
    timeline: [],
    ...patch,
  };
  const agents = new Map(doc.agents);
  agents.set(id, base);
  return { ...doc, agents, nextLabelIdx: doc.nextLabelIdx + 1 };
}

function pushTimeline(agent: AgentRuntime, item: TimelineItem): AgentRuntime {
  return { ...agent, timeline: [...agent.timeline, item] };
}

function updateTimeline(
  agent: AgentRuntime,
  id: number,
  update: (item: TimelineItem) => TimelineItem,
): AgentRuntime {
  return {
    ...agent,
    timeline: agent.timeline.map((it) => (it.id === id ? update(it) : it)),
  };
}

/** Open a new live think block on this agent. */
function openThink(doc: DocState, agentId: number): DocState {
  const id = doc.nextTimelineId;
  const next = replaceAgent(doc, agentId, (a) =>
    pushTimeline({ ...a, currentThinkId: id, phase: 'thinking' }, {
      kind: 'think',
      id,
      title: 'Thinking…',
      body: '',
      live: true,
      openedAt: Date.now(),
      closedAt: null,
    }),
  );
  return { ...next, nextTimelineId: doc.nextTimelineId + 1 };
}

/** Close the agent's currently-live think block with finalBody. */
function closeThink(doc: DocState, agentId: number, finalBody: string): DocState {
  const agent = doc.agents.get(agentId);
  if (!agent || agent.currentThinkId === null) return doc;
  const thinkId = agent.currentThinkId;
  const title = extractTitle(finalBody);
  return replaceAgent(doc, agentId, (a) =>
    updateTimeline({ ...a, currentThinkId: null, phase: 'content' }, thinkId, (it) =>
      it.kind === 'think'
        ? { ...it, body: finalBody, title, live: false, closedAt: Date.now() }
        : it,
    ),
  );
}

/** Close any live think block, keeping whatever body it holds — the
 *  recovery and tool-call paths may reach here without a `</think>`. */
function closeLiveThink(doc: DocState, agentId: number): DocState {
  const agent = doc.agents.get(agentId);
  if (!agent || agent.currentThinkId === null) return doc;
  const item = agent.timeline.find((it) => it.id === agent.currentThinkId);
  const finalBody = item && item.kind === 'think' ? item.body : '';
  return closeThink(doc, agentId, finalBody);
}

/** Advance the agent's live think block with freshly-produced text: append
 *  until `</think>` arrives, then close on the marker and seed contentBuffer
 *  with the tail so no token is lost at the boundary. */
function advanceThink(
  doc: DocState,
  agentId: number,
  text: string,
  tokenCount: number,
): DocState {
  const agent = doc.agents.get(agentId);
  if (!agent || agent.currentThinkId === null) return doc;
  const thinkId = agent.currentThinkId;
  const item = agent.timeline.find((it) => it.id === thinkId);
  if (!item || item.kind !== 'think') return doc;

  const combined = item.body + text;
  const markerIdx = combined.indexOf(THINK_CLOSE);
  if (markerIdx === -1) {
    return replaceAgent(doc, agentId, (a) =>
      updateTimeline({ ...a, tokenCount }, thinkId, (it) =>
        it.kind === 'think' ? { ...it, body: combined } : it,
      ),
    );
  }
  const finalBody = combined.slice(0, markerIdx);
  const tail = combined.slice(markerIdx + THINK_CLOSE.length);
  const closed = closeThink(doc, agentId, finalBody);
  return replaceAgent(closed, agentId, (a) => ({
    ...a,
    tokenCount,
    contentBuffer: tail,
  }));
}

// ── the fold ─────────────────────────────────────────────────────

const EMPTY_SYNTH: SynthState = { open: false, buffer: '', done: false, stats: null };

/** Where an event lands. 'session' folds into SessionState; 'run' folds into
 *  the document the run owns (`runDocId`). Events with richer routing (query,
 *  doc, doc:active, run:aborted, ui:error) have explicit cases in `reduce`.
 *  Anything unlisted (agent:trace, host telemetry) is ignored. */
type Scope = 'session' | 'run';
const SCOPE: Partial<Record<WorkflowEvent['type'], Scope>> = {
  // session facts
  'config:loaded': 'session', 'config:updated': 'session',
  'participation:toggled': 'session', 'abilities:state': 'session',
  'corpus:indexed': 'session', 'weights:label': 'session', 'weights:done': 'session',
  'library:list': 'session', 'library:search': 'session',
  'stats': 'session', 'agent:tick': 'session', // both feed session.pressure
  // the running document
  'plan:start': 'run', 'plan': 'run',
  'plan:task_updated': 'run', 'plan:task_added': 'run',
  'plan:task_deleted': 'run', 'plan:task_moved': 'run',
  'preflight:start': 'run', 'preflight:done': 'run',
  'research:start': 'run', 'research:done': 'run',
  'fanout:tasks': 'run', 'fanout:waiting': 'run',
  'spine:task': 'run', 'spine:source': 'run', 'spine:task:done': 'run',
  'synthesize:start': 'run', 'synthesize:done': 'run',
  'answer': 'run', 'complete': 'run', 'ui:plan_review': 'run',
  'agent:spawn': 'run', 'agent:produce': 'run', 'agent:tool_call': 'run',
  'agent:tool_retry': 'run', 'agent:tool_result': 'run', 'agent:tool_progress': 'run',
  'agent:return': 'run', 'agent:recovered': 'run', 'agent:failed': 'run',
  'agent:done': 'run',
  'run:paused': 'run', 'run:resumed': 'run', 'run:windingDown': 'run',
};

function withDoc(
  state: AppState,
  id: DocId,
  doc: DocState,
  extra: Partial<Pick<AppState, 'activeDocId' | 'runDocId'>>,
): AppState {
  const documents = new Map(state.documents);
  documents.set(id, doc);
  return { ...state, documents, ...extra };
}

/** Birth — the only fresh document state in the system. */
function newDoc(ev: Extract<WorkflowEvent, { type: 'query' }>): DocState {
  return {
    id: ev.docId,
    query: ev.query,
    attachments: ev.attachments ?? [],
    mode: null,
    direct: !!ev.direct,
    runEffort: ev.effort ?? null,
    phase: 'planning',
    plan: null,
    agents: new Map(),
    researchAgentIds: [],
    reconAgentIds: [],
    waitingTaskIndices: [],
    pendingTaskIndex: null,
    pendingTaskDescription: null,
    researchSpawnCount: 0,
    researchAgentCount: 0,
    nextTimelineId: 0,
    nextLabelIdx: 0,
    synth: EMPTY_SYNTH,
    answer: null,
    exchanges: [],
    ask: null,
    askAttachments: [],
    paused: false,
    closing: false,
    closedEarly: false,
    pipelineElapsedMs: 0,
    pipelineResumedAt: Date.now(),
  };
}

/** A warm ask INTO the settled document: the document stands — title, answer,
 *  exchanges, prior agents untouched — only the little run's own state
 *  resets. The doc keeps its birth shape (`direct`). */
function askBranch(doc: DocState, ev: Extract<WorkflowEvent, { type: 'query' }>): DocState {
  return {
    ...doc,
    ask: ev.query,
    askAttachments: (ev.attachments ?? []).map((a) => a.digest),
    runEffort: ev.effort ?? doc.runEffort,
    synth: EMPTY_SYNTH,
    waitingTaskIndices: [],
    paused: false,
    closing: false,
    pipelineElapsedMs: 0,
    pipelineResumedAt: Date.now(),
  };
}

/** A settled document, whole, from disk. */
function settledDoc(ev: Extract<WorkflowEvent, { type: 'doc' }>): DocState {
  return {
    id: ev.docId,
    query: ev.title,
    attachments: ev.attachments ?? [],
    mode: ev.mode,
    direct: false,
    runEffort: null,
    phase: 'done',
    plan: null,
    agents: new Map(),
    researchAgentIds: [],
    reconAgentIds: [],
    waitingTaskIndices: [],
    pendingTaskIndex: null,
    pendingTaskDescription: null,
    researchSpawnCount: 0,
    researchAgentCount: 0,
    nextTimelineId: 0,
    nextLabelIdx: 0,
    synth: EMPTY_SYNTH,
    answer: ev.answer,
    exchanges: ev.exchanges,
    ask: null,
    askAttachments: [],
    paused: false,
    closing: false,
    closedEarly: false,
    pipelineElapsedMs: 0,
    pipelineResumedAt: null,
  };
}

/** The run stopped short of complete. A doc with a settled answer stands
 *  (its in-flight ask clears); a stillborn doc dies and the canvas falls
 *  back to the picker if it was watching it. */
function abortRun(state: AppState): AppState {
  const id = state.runDocId;
  if (id === null) return state;
  const doc = state.documents.get(id);
  if (!doc) return { ...state, runDocId: null };
  if (doc.answer !== null) {
    const banked = doc.pipelineResumedAt
      ? doc.pipelineElapsedMs + (Date.now() - doc.pipelineResumedAt)
      : doc.pipelineElapsedMs;
    return withDoc(state, id, {
      ...doc,
      ask: null,
      askAttachments: [],
      synth: { ...doc.synth, open: false },
      paused: false,
      closing: false,
      pipelineElapsedMs: banked,
      pipelineResumedAt: null,
    }, { runDocId: null });
  }
  const documents = new Map(state.documents);
  documents.delete(id);
  return {
    ...state,
    documents,
    activeDocId: state.activeDocId === id ? null : state.activeDocId,
    runDocId: null,
  };
}

// ── reducer entry ────────────────────────────────────────────────

export function reduce(state: AppState, ev: WorkflowEvent): AppState {
  switch (ev.type) {
    case 'query': {
      const existing = state.documents.get(ev.docId);
      if (ev.warm && existing?.answer)
        // An ask under the settled doc it names.
        return withDoc(state, ev.docId, askBranch(existing, ev),
          { activeDocId: ev.docId, runDocId: ev.docId });
      if (existing)
        // A clarify/change_mode round's re-echo — same identity, nothing
        // wiped, nothing re-born.
        return { ...state, activeDocId: ev.docId, runDocId: ev.docId };
      return withDoc(state, ev.docId, newDoc(ev),
        { activeDocId: ev.docId, runDocId: ev.docId });
    }

    case 'doc':
      // Upsert only — activation is doc:active's job. The RUNNING document
      // is the one exception: its live fold state is truer than its disk
      // snapshot (an in-flight ask would be clobbered), so disk never
      // overwrites a running document.
      if (state.runDocId === ev.docId) return state;
      return withDoc(state, ev.docId, settledDoc(ev), {});

    case 'doc:active':
      return { ...state, activeDocId: ev.docId };

    case 'run:aborted':
      return abortRun(state);

    case 'ui:error': {
      // A toast, nothing more. One event, one meaning: abort semantics
      // belong to run:aborted alone — a run that DIES emits both, while a
      // benign failure (a bad config path, a failed search) toasts without
      // touching any document. The old conflation let an inline error nuke
      // a live or parked doc.
      const toastId = state.session.nextToastId + 1;
      return {
        ...state,
        session: {
          ...state.session,
          toast: { id: toastId, message: ev.message, tone: 'error' },
          nextToastId: toastId,
        },
      };
    }
  }

  const scope = SCOPE[ev.type];
  if (scope === 'session') {
    const session = sessionReduce(state.session, ev);
    return session === state.session ? state : { ...state, session };
  }
  if (scope === 'run') {
    const doc = state.runDocId !== null ? state.documents.get(state.runDocId) : undefined;
    if (!doc) return state; // straggler with no run — dropped
    const next = docReduce(doc, ev);
    const out = next === doc ? state : withDoc(state, doc.id, next, {});
    return ev.type === 'complete' ? { ...out, runDocId: null } : out;
  }
  return state; // agent:trace, host telemetry — the dev pane folds its own
}

// ── session facts ────────────────────────────────────────────────

function sessionReduce(s: SessionState, ev: WorkflowEvent): SessionState {
  switch (ev.type) {
    case 'config:loaded':
      return {
        ...s,
        dev: ev.dev ?? s.dev,
        config: ev.config,
        participation: seedParticipation(s.participation, ev.config),
      };

    case 'config:updated': {
      const toastId = s.nextToastId + 1;
      // `savedTo: null` = a served session's in-memory patch (nothing on disk);
      // a path = the edge runner persisted to harness.json.
      const message = ev.savedTo === null
        ? 'applied for this session'
        : ev.skipped.length > 0
          ? `saved → ${shortPath(ev.savedTo)} (skipped: ${ev.skipped.join(', ')} — env active)`
          : ev.gitignored
            ? `saved → ${shortPath(ev.savedTo)} (added to .gitignore)`
            : `saved → ${shortPath(ev.savedTo)}`;
      return {
        ...s,
        config: ev.config,
        participation: seedParticipation(s.participation, ev.config),
        toast: { id: toastId, message, tone: ev.skipped.length > 0 ? 'warn' : 'success' },
        nextToastId: toastId,
      };
    }

    case 'participation:toggled': {
      const current = s.participation[ev.name] ?? true;
      // Any change to the filter drops a standing toast: whatever it was
      // complaining about, the user has just answered it.
      return {
        ...s,
        participation: { ...s.participation, [ev.name]: !current },
        toast: null,
      };
    }

    case 'abilities:state':
      return { ...s, abilities: ev.abilities };

    case 'weights:label':
      return { ...s, loadingLabel: ev.label };

    case 'weights:done':
      // The session is READY — weights loaded, the picker can submit.
      return { ...s, loadingLabel: null, phase: 'ready' };

    case 'corpus:indexed':
      return { ...s, corpusStatus: { fileCount: ev.fileCount, chunkCount: ev.chunkCount } };

    case 'stats':
      return { ...s, pressure: { pct: ev.ctxPct, cellsUsed: ev.ctxPos, nCtx: ev.ctxTotal } };

    case 'agent:tick':
      return {
        ...s,
        pressure: {
          pct: ev.nCtx > 0 ? Math.round((100 * ev.cellsUsed) / ev.nCtx) : 0,
          cellsUsed: ev.cellsUsed,
          nCtx: ev.nCtx,
        },
      };

    case 'library:search':
      return { ...s, librarySearch: ev.query ? { query: ev.query, ranked: ev.ranked } : null };

    case 'library:list':
      return { ...s, library: { entries: ev.entries } };

    default:
      return s;
  }
}

// ── the running document ─────────────────────────────────────────

function docReduce(doc: DocState, ev: WorkflowEvent): DocState {
  /** An ask streams beneath a settled document — its phase NEVER leaves
   *  'done'; the run machinery works without moving the canvas. This is the
   *  total rule that lets moment/status be plain tables. */
  const asking = doc.ask !== null;

  switch (ev.type) {
    case 'plan':
      return {
        ...doc,
        phase: ev.intent === 'clarify' ? 'clarifying' : doc.phase,
        plan: {
          intent: ev.intent,
          tasks: ev.tasks,
          clarifyQuestions: ev.clarifyQuestions,
          tokenCount: ev.tokenCount,
          timeMs: ev.timeMs,
        },
      };

    case 'plan:task_updated': {
      if (!doc.plan) return doc;
      if (ev.index < 0 || ev.index >= doc.plan.tasks.length) return doc;
      const tasks = doc.plan.tasks.map((t, i) =>
        i === ev.index ? { ...t, description: ev.description } : t,
      );
      return { ...doc, plan: { ...doc.plan, tasks } };
    }

    case 'plan:task_added': {
      if (!doc.plan) return doc;
      // afterIndex: -1 prepends; otherwise insert at afterIndex + 1.
      const insertAt = Math.max(0, Math.min(doc.plan.tasks.length, ev.afterIndex + 1));
      const tasks = [
        ...doc.plan.tasks.slice(0, insertAt),
        { description: '' },
        ...doc.plan.tasks.slice(insertAt),
      ];
      return { ...doc, plan: { ...doc.plan, tasks } };
    }

    case 'plan:task_deleted': {
      if (!doc.plan) return doc;
      // Don't allow deleting the only task — keeps the plan-review valid.
      if (doc.plan.tasks.length <= 1) return doc;
      if (ev.index < 0 || ev.index >= doc.plan.tasks.length) return doc;
      const tasks = doc.plan.tasks.filter((_, i) => i !== ev.index);
      return { ...doc, plan: { ...doc.plan, tasks } };
    }

    case 'plan:task_moved': {
      if (!doc.plan) return doc;
      const n = doc.plan.tasks.length;
      if (ev.from === ev.to) return doc;
      if (ev.from < 0 || ev.from >= n) return doc;
      if (ev.to < 0 || ev.to >= n) return doc;
      const tasks = [...doc.plan.tasks];
      const [moved] = tasks.splice(ev.from, 1);
      tasks.splice(ev.to, 0, moved);
      return { ...doc, plan: { ...doc.plan, tasks } };
    }

    case 'preflight:start':
      // A new recon pass — clear the run scaffolding, keep the document.
      if (asking) return { ...doc, pipelineResumedAt: Date.now() };
      return {
        ...doc,
        phase: 'discovering',
        agents: new Map(),
        reconAgentIds: [],
        researchAgentIds: [],
        waitingTaskIndices: [],
        pendingTaskIndex: null,
        pendingTaskDescription: null,
        researchSpawnCount: 0,
        researchAgentCount: 0,
        nextTimelineId: 0,
        nextLabelIdx: 0,
        pipelineResumedAt: Date.now(),
      };

    case 'preflight:done':
      return doc;

    case 'plan:start':
      // A warm ask's synthetic plan must not retitle the document or leave
      // the settled canvas — the ask streams beneath it.
      if (asking) return { ...doc, plan: null, pipelineResumedAt: Date.now() };
      // A planner pass (first or re-plan): recon agents vanish here, the
      // planner is A0 again, the accumulator keeps counting.
      return {
        ...doc,
        phase: 'planning',
        plan: null,
        mode: ev.mode === 'flat' ? 'flat' : 'deep',
        agents: new Map(),
        reconAgentIds: [],
        researchAgentIds: [],
        waitingTaskIndices: [],
        pendingTaskIndex: null,
        pendingTaskDescription: null,
        researchSpawnCount: 0,
        researchAgentCount: 0,
        nextTimelineId: 0,
        nextLabelIdx: 0,
        pipelineResumedAt: Date.now(),
      };

    case 'ui:plan_review': {
      // Pause the pipeline timer — the user is dwelling, not the machine.
      const accrued = doc.pipelineResumedAt
        ? doc.pipelineElapsedMs + (Date.now() - doc.pipelineResumedAt)
        : doc.pipelineElapsedMs;
      return { ...doc, phase: 'plan_review', pipelineElapsedMs: accrued, pipelineResumedAt: null };
    }

    case 'research:start':
      return {
        ...doc,
        phase: asking ? doc.phase : 'research',
        mode: ev.mode === 'flat' ? 'flat' : 'deep',
        // Authoritative fork count — derived harness-side from plan.tasks
        // BEFORE the pool spawns; the renderer's plan can be empty/late.
        researchAgentCount: ev.agentCount,
        pipelineResumedAt: Date.now(),
      };

    case 'research:done':
      return asking ? doc : { ...doc, phase: 'synthesizing' };

    case 'fanout:tasks':
      return doc;

    case 'fanout:waiting':
      return { ...doc, waitingTaskIndices: ev.taskIndices };

    case 'spine:task':
      return { ...doc, pendingTaskIndex: ev.taskIndex, pendingTaskDescription: ev.description };

    case 'spine:source':
    case 'spine:task:done':
      return doc;

    case 'synthesize:start':
      return {
        ...doc,
        phase: asking ? doc.phase : 'synthesizing',
        synth: { open: true, buffer: '', done: false, stats: null },
      };

    case 'synthesize:done':
      return {
        ...doc,
        synth: {
          ...doc.synth,
          open: false,
          done: true,
          stats: {
            tokens: ev.tokenCount,
            toolCalls: ev.toolCallCount,
            ppl: ev.ppl,
            timeMs: ev.timeMs,
          },
        },
      };

    case 'answer':
      // A warm ask's answer lands as a new exchange beneath the document —
      // the root answer is never overwritten.
      if (doc.ask !== null) {
        return {
          ...doc,
          exchanges: [...doc.exchanges, { question: doc.ask, body: ev.text, attachments: doc.askAttachments }],
          ask: null,
          askAttachments: [],
        };
      }
      return { ...doc, answer: ev.text };

    case 'complete': {
      // Settled — bank the last active slice and freeze the timer.
      const accrued = doc.pipelineResumedAt
        ? doc.pipelineElapsedMs + (Date.now() - doc.pipelineResumedAt)
        : doc.pipelineElapsedMs;
      return {
        ...doc,
        phase: 'done',
        paused: false,
        closing: false,
        pipelineElapsedMs: accrued,
        pipelineResumedAt: null,
      };
    }

    case 'run:paused': {
      // Bank the timer so a held span never counts as time spent.
      const accrued = doc.pipelineResumedAt
        ? doc.pipelineElapsedMs + (Date.now() - doc.pipelineResumedAt)
        : doc.pipelineElapsedMs;
      return { ...doc, paused: true, pipelineElapsedMs: accrued, pipelineResumedAt: null };
    }
    case 'run:resumed':
      return { ...doc, paused: false, pipelineResumedAt: Date.now() };
    case 'run:windingDown':
      return { ...doc, closing: true, closedEarly: true };

    case 'agent:spawn': {
      // Pre-flight recon agent: stream it through the same timeline machinery
      // as research (taskIndex 0 so the produce/tool handlers engage), but
      // track it in reconAgentIds so the research column never picks it up.
      if (doc.phase === 'discovering') {
        const next = createAgent(doc, ev.agentId, {
          phase: 'thinking',
          taskIndex: 0,
          taskDescription: 'Probing sources',
        });
        return openThink(
          { ...next, reconAgentIds: [...next.reconAgentIds, ev.agentId] },
          ev.agentId,
        );
      }

      // Non-research phase: track the agent but don't open a timeline. An
      // in-flight ask researches while the doc stays 'done'.
      if (doc.phase !== 'research' && !asking) {
        return createAgent(doc, ev.agentId, { phase: 'idle', taskIndex: null });
      }

      // Research phase: bind taskIndex + description, open the first think block.
      let taskIndex: number;
      let description: string | null;
      let nextPendingIdx: number | null = doc.pendingTaskIndex;
      let nextPendingDesc: string | null = doc.pendingTaskDescription;
      if (doc.mode === 'deep') {
        taskIndex = nextPendingIdx ?? doc.researchSpawnCount;
        description = nextPendingDesc
          ?? doc.plan?.tasks[taskIndex]?.description
          ?? null;
        nextPendingIdx = null;
        nextPendingDesc = null;
      } else {
        taskIndex = doc.researchSpawnCount;
        description = doc.plan?.tasks[taskIndex]?.description ?? null;
      }

      const dependencyHint =
        doc.mode === 'deep' && taskIndex > 0
          ? `builds on Task ${taskIndex}`
          : null;

      let next = createAgent(doc, ev.agentId, {
        phase: 'thinking',
        taskIndex,
        taskDescription: description,
        dependencyHint,
      });
      next = {
        ...next,
        researchAgentIds: [...next.researchAgentIds, ev.agentId],
        researchSpawnCount: doc.researchSpawnCount + 1,
        pendingTaskIndex: nextPendingIdx,
        pendingTaskDescription: nextPendingDesc,
      };
      return openThink(next, ev.agentId);
    }

    case 'agent:produce': {
      // Settling pass: accumulate into the synth buffer.
      if (doc.synth.open) {
        return { ...doc, synth: { ...doc.synth, buffer: doc.synth.buffer + ev.text } };
      }
      // Planner stream: the outline drafts itself in the view — accumulate
      // the planner's grammar JSON so a renderer can lift task descriptions
      // as they complete (the plan grammar opens no think block).
      if (doc.phase === 'planning') {
        const planner = doc.agents.get(ev.agentId);
        if (!planner) return doc;
        return replaceAgent(doc, planner.id, (a) => ({
          ...a,
          tokenCount: ev.tokenCount,
          contentBuffer: a.contentBuffer + ev.text,
        }));
      }
      // Muted phases. 'discovering' streams through the same path as
      // 'research' (its agent has taskIndex 0); an in-flight ask researches
      // under a 'done' doc.
      if (doc.phase !== 'research' && doc.phase !== 'discovering' && !asking) return doc;

      const agent = doc.agents.get(ev.agentId);
      if (!agent || agent.taskIndex === null) return doc;

      let working = doc;
      let acting = agent;

      // Content-phase tokens (post-</think>, pre-tool_call) — the model is
      // writing tool-call JSON. For the terminal `report` tool, the report
      // body lives inside that JSON. Stream into contentBuffer so it's
      // visible; cleared on tool_call / report when the structured event
      // lands.
      if (acting.phase === 'content') {
        return replaceAgent(working, acting.id, (a) => ({
          ...a,
          tokenCount: ev.tokenCount,
          contentBuffer: a.contentBuffer + ev.text,
        }));
      }

      // Recovery stream (post agent:done): `recoverInline` force-extracts the
      // report under an EAGER report grammar with no `<think>`/`</think>`.
      // Route it into contentBuffer (→ "Writing report") instead of opening a
      // think block, so a forced report isn't mislabeled as the agent
      // "Thinking". Cleared on agent:return/recovered. See docs/upstream-issues.md.
      if (acting.recovering) {
        return replaceAgent(working, acting.id, (a) => ({
          ...a,
          tokenCount: ev.tokenCount,
          contentBuffer: a.contentBuffer + ev.text,
        }));
      }

      // Re-enter thinking after tool_result / recovery / initial idle.
      if (acting.phase !== 'thinking' || acting.currentThinkId === null) {
        if (acting.phase === 'tool' || acting.phase === 'idle') {
          working = openThink(working, acting.id);
        } else {
          // done — drop.
          return replaceAgent(working, acting.id, (a) => ({ ...a, tokenCount: ev.tokenCount }));
        }
      }
      return advanceThink(working, acting.id, ev.text, ev.tokenCount);
    }

    case 'agent:tool_call': {
      const agent = doc.agents.get(ev.agentId);
      if (!agent) return doc;

      // Force-close any live think block first.
      let working = closeLiveThink(doc, ev.agentId);

      // Skip timeline entry for non-research agents (synth may also emit tool_calls).
      if (working.agents.get(ev.agentId)?.taskIndex == null) {
        return replaceAgent(working, ev.agentId, (a) => ({
          ...a,
          phase: 'tool',
          toolCallCount: a.toolCallCount + 1,
        }));
      }

      // Terminal `report` tool: this fires at the stop token, but the report
      // already streamed live as a "Writing report" row (the model's report
      // body flowed into `contentBuffer` during the content phase — see the
      // marker extractor in Work.tsx). Pushing a generic tool_call row here
      // would render a misleading "Reading" timeline entry; instead just
      // advance phase/counts and clear the streamed buffer. `agent:return`
      // finalizes the report into a structured `report` item next.
      // Detection: the agent was mid-report stream iff its `contentBuffer`
      // (raw post-</think> tokens, not yet cleared) already holds the report
      // open marker. Belt-and-suspenders on the terminal tool name, which in
      // reasoning.run's own UI is always `report`.
      const acting = working.agents.get(ev.agentId);
      const wasReporting =
        ev.tool === 'report' ||
        (acting?.contentBuffer.includes('<parameter=result>') ?? false);
      if (wasReporting) {
        return replaceAgent(working, ev.agentId, (a) => ({
          ...a,
          phase: 'tool',
          toolCallCount: a.toolCallCount + 1,
          contentBuffer: '',
        }));
      }

      const id = working.nextTimelineId;
      const next = replaceAgent(working, ev.agentId, (a) =>
        pushTimeline(
          {
            ...a,
            phase: 'tool',
            toolCallCount: a.toolCallCount + 1,
            pendingToolCallId: id,
            contentBuffer: '',
          },
          {
            kind: 'tool_call',
            id,
            tool: ev.tool,
            argsSummary: formatArgSummary(ev.tool, ev.args),
          },
        ),
      );
      return { ...next, nextTimelineId: working.nextTimelineId + 1 };
    }

    case 'agent:tool_retry': {
      const agent = doc.agents.get(ev.agentId);
      if (!agent) return doc;
      return replaceAgent(doc, ev.agentId, (a) => ({
        ...a,
        retry: { tool: ev.tool, retryAt: Date.now() + ev.retryAfterMs, attempt: ev.attempt },
      }));
    }

    case 'agent:tool_result': {
      const agent = doc.agents.get(ev.agentId);
      if (!agent) return doc;

      if (agent.taskIndex == null) {
        return replaceAgent(doc, ev.agentId, (a) => ({ ...a, phase: 'idle', retry: null }));
      }

      const summary = summarizeResult(ev.tool, ev.result);
      const id = doc.nextTimelineId;
      const hostsUnique = Array.from(new Set(summary.hosts));
      const next = replaceAgent(doc, ev.agentId, (a) =>
        pushTimeline(
          { ...a, phase: 'idle', pendingToolCallId: null, retry: null },
          {
            kind: 'tool_result',
            id,
            tool: ev.tool,
            callId: agent.pendingToolCallId,
            byteLength: ev.result.length,
            preview: summary.preview,
            hosts: hostsUnique,
            resultCount: summary.resultCount,
            sources: summary.sources,
          },
        ),
      );
      return {
        ...next,
        nextTimelineId: doc.nextTimelineId + 1,
      };
    }

    case 'agent:tool_progress':
      return doc;

    case 'agent:return':
    case 'agent:recovered': {
      const agent = doc.agents.get(ev.agentId);
      if (!agent) return doc;

      const working = closeLiveThink(doc, ev.agentId);

      if (working.agents.get(ev.agentId)?.taskIndex == null) {
        return replaceAgent(working, ev.agentId, (a) => ({
          ...a,
          phase: 'done',
          endedAt: Date.now(),
          contentBuffer: '',
          recovering: false,
        }));
      }

      const id = working.nextTimelineId;
      const next = replaceAgent(working, ev.agentId, (a) =>
        pushTimeline(
          { ...a, phase: 'done', endedAt: Date.now(), contentBuffer: '', recovering: false },
          {
            kind: 'report',
            id,
            body: ev.result,
            tokenCount: a.tokenCount,
          },
        ),
      );

      return { ...next, nextTimelineId: working.nextTimelineId + 1 };
    }

    case 'agent:failed': {
      // Forced recovery FAILED (no result — e.g. KV exhausted mid-report decode →
      // `llama_decode failed`). The agent already showed "Writing report"
      // (agent:done set `recovering`); without this it spins forever. Mark it
      // terminally `failed` → cross glyph + frozen timer. There is no report.
      const agent = doc.agents.get(ev.agentId);
      if (!agent || agent.phase === 'done' || agent.phase === 'failed') return doc;
      const working = closeLiveThink(doc, ev.agentId);
      // Frozen with no `report` item — the cross glyph + failReason tell why.
      const next = replaceAgent(working, ev.agentId, (a) => ({
        ...a,
        phase: 'failed',
        endedAt: Date.now(),
        contentBuffer: '',
        recovering: false,
        failReason: ev.reason,
      }));
      return next;
    }

    case 'agent:done': {
      // Do NOT mark the agent `done` here. In the stall-break path,
      // agent:done fires BEFORE recoverInline streams recovery tokens via
      // agent:produce → agent:recovered. Freezing to `done` would drop those
      // tokens. Force-close any live think and step back to `idle`, marking
      // the agent `recovering` so the produce handler routes the forced
      // report into contentBuffer (→ "Writing report") rather than a think
      // block. Only agent:return / agent:recovered mark `done`.
      //
      // Clear the stale contentBuffer too: if the agent was in `content` phase
      // when killed (mid tool-call JSON), the partial buffer never resolves to
      // a tool_call; recovery refills it with the actual forced report.
      const agent = doc.agents.get(ev.agentId);
      if (!agent || agent.phase === 'done') return doc;
      const working = closeLiveThink(doc, ev.agentId);
      return replaceAgent(working, ev.agentId, (a) => ({
        ...a,
        phase: 'idle',
        // Drop any partial content buffer: if the agent is being force-recovered
        // it never closed the terminal call, so recovery prose (refilled into
        // contentBuffer while `recovering`) drives the "Writing report" row now.
        contentBuffer: '',
        recovering: true,
      }));
    }


    default:
      return doc;
  }
}
