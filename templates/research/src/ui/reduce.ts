/**
 * Pure event → AppState fold: the ONE fold every target shares.
 *
 * Owns what this product decides — where an event lands (a session fact, or
 * the document the run writes into), a document's phases and its birth, the
 * settling buffer, and what a spawn is FOR: a source probe, a task named by
 * its key, or an agent tracked without a timeline. The agent records
 * themselves belong to the generic fold (`@lloyal-labs/ui/fold`) — think
 * blocks, tool rows, reports and their terminal transitions live there, and
 * this file only hands it a decision.
 *
 * Emits no side effects and imports nothing from node, so the terminal view,
 * the desktop shell's own fold and the browser page all run it.
 */

import { emptyRoster, foldAgents } from '@lloyal-labs/ui/fold';
import type { AgentRoster, AgentEvent as FoldableAgentEvent } from '@lloyal-labs/ui/fold';
import type { AppState, SessionState, DocState, DocId, AgentRuntime, SynthState } from './state.js';
import type { WorkflowEvent } from '../brief/protocol.js';

/** This harness's terminal tool: its call ends the turn and is no timeline row. */
const TERMINAL = 'report';

/** Collapse a home-prefixed absolute path for a toast: `~/…`. Hand-written to stay browser-safe — no
 *  `node:os`, no `node:path` — because every target runs this file. Its inverse, `~` expansion for
 *  config input, is genuinely node's and lives in `resolvePath` (`@lloyal-labs/rig/node`). */
function shortPath(p: string): string {
  if (!p) return p;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const home = env?.HOME ?? env?.USERPROFILE;
  if (home && (p === home || p.startsWith(home + '/') || p.startsWith(home + '\\'))) return '~' + p.slice(home.length);
  return p;
}

/** The fold returns the same roster when an event changed nothing; so does this. */
const folded = (doc: DocState, r: AgentRoster): DocState => (r === doc.roster ? doc : { ...doc, roster: r });

function replaceAgent(doc: DocState, id: number, patch: (a: AgentRuntime) => AgentRuntime): DocState {
  const existing = doc.roster.agents.get(id);
  if (!existing) return doc;
  const agents = new Map(doc.roster.agents);
  agents.set(id, patch(existing));
  return { ...doc, roster: { ...doc.roster, agents } };
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
  'corpus:indexed': 'session', 'weights:done': 'session',
  'library:list': 'session', 'library:search': 'session',
  'stats': 'session', 'agent:tick': 'session', // both feed session.pressure
  // the running document
  'plan:start': 'run', 'plan': 'run',
  'plan:task_updated': 'run', 'plan:task_added': 'run',
  'plan:task_deleted': 'run', 'plan:task_moved': 'run',
  'preflight:start': 'run', 'preflight:done': 'run',
  'research:start': 'run', 'research:done': 'run',
  'fanout:tasks': 'run',
  'spine:task': 'run', 'spine:source': 'run', 'spine:task:done': 'run',
  'synthesize:start': 'run', 'synthesize:done': 'run',
  'answer': 'run', 'complete': 'run', 'ui:plan_review': 'run', 'ui:clarify': 'run',
  'agent:spawn': 'run', 'agent:produce': 'run', 'agent:tool_call': 'run',
  'agent:tool_retry': 'run', 'agent:tool_result': 'run', 'agent:tool_progress': 'run', 'agent:prefilled': 'run',
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

/** A document's fields at rest — the ONE place the shape is spelled. A birth, a restore and the
 *  selectors' empty document all start here and change only what they know. */
export function emptyDoc(): DocState {
  return {
    id: '', query: '', attachments: [], mode: null, direct: false, runEffort: null,
    phase: 'done', plan: null, revision: null,
    roster: emptyRoster(),
    researchAgentIds: [], reconAgentIds: [],
    pendingTaskIndex: null, pendingTaskDescription: null,
    researchSpawnCount: 0, researchAgentCount: 0,
    synth: EMPTY_SYNTH, answer: null, exchanges: [], ask: null, askAttachments: [],
    paused: false, closing: false, closedEarly: false,
    pipelineElapsedMs: 0, pipelineResumedAt: null,
  };
}

/** Birth — the only fresh document state in the system. */
function newDoc(ev: Extract<WorkflowEvent, { type: 'query' }>): DocState {
  return {
    ...emptyDoc(),
    id: ev.docId,
    query: ev.query,
    attachments: ev.attachments ?? [],
    direct: !!ev.direct,
    runEffort: ev.effort ?? null,
    phase: 'planning',
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
    paused: false,
    closing: false,
    pipelineElapsedMs: 0,
    pipelineResumedAt: Date.now(),
  };
}

/** A settled document, whole, from disk. */
function settledDoc(ev: Extract<WorkflowEvent, { type: 'doc' }>): DocState {
  return {
    ...emptyDoc(),
    id: ev.docId,
    query: ev.title,
    attachments: ev.attachments ?? [],
    mode: ev.mode,
    // What the run that WROTE it chose. A report from before these were recorded reports null, and the
    // byline falls back to the reader's dial — which is the old behaviour, now only where the record is silent.
    runEffort: ev.effort ?? null,
    direct: ev.direct,
    answer: ev.answer,
    exchanges: ev.exchanges,
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
      revision: null,
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
      // touching any document.
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
        roster: emptyRoster(),
        reconAgentIds: [],
        researchAgentIds: [],
        pendingTaskIndex: null,
        pendingTaskDescription: null,
        researchSpawnCount: 0,
        researchAgentCount: 0,
        pipelineResumedAt: Date.now(),
      };

    case 'preflight:done':
      // Discovery is over; the planner speaks next. `preflight:start` moved the canvas to
      // 'discovering' and nothing moved it back — the round's own `plan:start` used to, which is how
      // ONE event came to own two jobs: opening a round, and ending discovery. The brief opens the
      // round now, before any of this, so the end of discovery says so itself: the probes' timeline
      // vanishes and the planner is A0 again, which is what lets the outline draft in the view.
      if (asking) return doc;
      return {
        ...doc,
        phase: 'planning',
        roster: emptyRoster(),
        reconAgentIds: [],
        pipelineResumedAt: Date.now(),
      };

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
        revision: null,
        mode: ev.mode === 'flat' ? 'flat' : 'deep',
        roster: emptyRoster(),
        reconAgentIds: [],
        researchAgentIds: [],
        pendingTaskIndex: null,
        pendingTaskDescription: null,
        researchSpawnCount: 0,
        researchAgentCount: 0,
        pipelineResumedAt: Date.now(),
      };

    case 'ui:plan_review': {
      // Pause the pipeline timer — the user is dwelling, not the machine.
      const accrued = doc.pipelineResumedAt
        ? doc.pipelineElapsedMs + (Date.now() - doc.pipelineResumedAt)
        : doc.pipelineElapsedMs;
      return { ...doc, phase: 'plan_review', revision: ev.revision, pipelineElapsedMs: accrued, pipelineResumedAt: null };
    }

    case 'ui:clarify':
      // The planner asked and the round is armed: the composer takes the answer, at this revision.
      return { ...doc, phase: 'clarifying', revision: ev.revision };

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
        revision: null,
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
      // Pre-flight recon agent: streamed through the same timeline machinery as research (task 0), tracked
      // in reconAgentIds so the research column never picks it up.
      if (doc.phase === 'discovering') {
        return { ...doc, reconAgentIds: [...doc.reconAgentIds, ev.agentId],
          roster: foldAgents(doc.roster, ev, { spawn: () => ({ taskIndex: 0, taskDescription: 'Probing sources' }), terminal: TERMINAL }) };
      }
      // Outside research, an agent is tracked without a timeline. An in-flight ask researches while the doc stays 'done'.
      if (doc.phase !== 'research' && !asking) {
        return folded(doc, foldAgents(doc.roster, ev, { spawn: () => ({ taskIndex: null }), terminal: TERMINAL }));
      }
      // Research: the spawn names its task (`key: task:<i>`, carried by the pool); a spawn without one falls back to
      // spawn order, as before the key existed. Deep mode's task description arrives on `spine:task` just before.
      const keyed = /^task:(\d+)$/.exec(ev.key ?? '');
      let taskIndex: number;
      let description: string | null;
      let nextPendingIdx: number | null = doc.pendingTaskIndex;
      let nextPendingDesc: string | null = doc.pendingTaskDescription;
      if (keyed) {
        taskIndex = Number(keyed[1]);
        description = (doc.mode === 'deep' ? nextPendingDesc : null) ?? doc.plan?.tasks[taskIndex]?.description ?? null;
        nextPendingIdx = null;
        nextPendingDesc = null;
      } else if (doc.mode === 'deep') {
        taskIndex = nextPendingIdx ?? doc.researchSpawnCount;
        description = nextPendingDesc ?? doc.plan?.tasks[taskIndex]?.description ?? null;
        nextPendingIdx = null;
        nextPendingDesc = null;
      } else {
        taskIndex = doc.researchSpawnCount;
        description = doc.plan?.tasks[taskIndex]?.description ?? null;
      }
      const dependencyHint = doc.mode === 'deep' && taskIndex > 0 ? `builds on Task ${taskIndex}` : null;
      const roster = foldAgents(doc.roster, ev, { spawn: () => ({ taskIndex, taskDescription: description, dependencyHint }), terminal: TERMINAL });
      return {
        ...doc,
        researchAgentIds: [...doc.researchAgentIds, ev.agentId],
        researchSpawnCount: doc.researchSpawnCount + 1,
        pendingTaskIndex: nextPendingIdx,
        pendingTaskDescription: nextPendingDesc,
        roster,
      };
    }

    case 'agent:produce': {
      // Settling pass: accumulate into the synth buffer.
      if (doc.synth.open) {
        return { ...doc, synth: { ...doc.synth, buffer: doc.synth.buffer + ev.text } };
      }
      // Planner stream: the outline drafts itself in the view — the planner's grammar JSON accumulates so a
      // renderer can lift task descriptions as they complete (the plan grammar opens no think block).
      if (doc.phase === 'planning') {
        const planner = doc.roster.agents.get(ev.agentId);
        if (!planner) return doc;
        return replaceAgent(doc, planner.id, (a) => ({ ...a, tokenCount: ev.tokenCount, contentBuffer: a.contentBuffer + ev.text }));
      }
      // Muted phases. 'discovering' streams like 'research'; an in-flight ask researches under a 'done' doc.
      if (doc.phase !== 'research' && doc.phase !== 'discovering' && !asking) return doc;
      return folded(doc, foldAgents(doc.roster, ev, { terminal: TERMINAL }));
    }

    case 'agent:tool_call':
    case 'agent:tool_retry':
    case 'agent:tool_result':
    case 'agent:return':
    case 'agent:recovered':
    case 'agent:failed':
    case 'agent:done':
      return folded(doc, foldAgents(doc.roster, ev as FoldableAgentEvent, { terminal: TERMINAL }));

    case 'agent:tool_progress':
      return doc;

    case 'agent:prefilled': {
      // A tool result that carried roots admitted them onto the run: they join the live ask (or the cold brief)
      // as they land, once each — the same roots the meta line books and a reopen restores.
      const roots = ev.attachments ?? [];
      if (roots.length === 0) return doc;
      if (doc.ask !== null) {
        const have = new Set(doc.askAttachments);
        const fresh = roots.map((a) => a.digest).filter((digest) => !have.has(digest));
        return fresh.length > 0 ? { ...doc, askAttachments: [...doc.askAttachments, ...fresh] } : doc;
      }
      const have = new Set(doc.attachments.map((a) => a.digest));
      const fresh = roots.filter((a) => !have.has(a.digest));
      return fresh.length > 0 ? { ...doc, attachments: [...doc.attachments, ...fresh] } : doc;
    }

    default:
      return doc;
  }
}
