/**
 * Fold-level tests for document identity: birth, ask, activation, isolation,
 * abort, and the totality of the moment/status tables. Pure — real `reduce`,
 * real selectors, no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, initialState, DOC_PHASES, type AppState } from '../../harness/state.js';
import type { WorkflowEvent } from '../../harness/events.js';
import {
  selectAnswer, selectEtaTasks, selectLive, selectMoment, selectReviewing,
  selectRunDepth, selectStatus,
} from '../../targets/_shared/select.js';

const fold = (events: WorkflowEvent[], from: AppState = initialState): AppState =>
  events.reduce(reduce, from);

const A = '2026-09-02T10-00-00-000';
const B = '2026-09-02T11-00-00-000';

const PLAN = {
  type: 'plan', intent: 'research',
  tasks: [{ description: 'a' }, { description: 'b' }],
  tokenCount: 10, timeMs: 100,
} as WorkflowEvent;

const COMPLETE = {
  type: 'complete',
  data: { wallTimeMs: 1, planMs: 0, researchMs: 0, synthMs: 0, passthroughMs: 0 },
} as WorkflowEvent;

/** A settled cold brief under docId A: the precondition every warm path
 *  starts from. */
const settled = (): AppState =>
  fold([
    { type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent,
    { type: 'plan:start', query: 'Q1', mode: 'flat' } as WorkflowEvent,
    PLAN,
    { type: 'research:start', agentCount: 2, mode: 'flat' } as WorkflowEvent,
    { type: 'answer', text: 'the settled answer' } as WorkflowEvent,
    COMPLETE,
  ]);

test('birth: the query echo mints the document and activates it', () => {
  const s = fold([{ type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent]);
  const doc = s.documents.get(A);
  assert.ok(doc);
  assert.equal(doc.phase, 'planning');
  assert.equal(doc.query, 'Q1');
  assert.equal(s.activeDocId, A);
  assert.equal(s.runDocId, A);
  // Session untouched by birth.
  assert.equal(s.session, initialState.session);
});

test('idempotence: the second query keeps ONE identity through a clarify re-plan', () => {
  let s = fold([
    { type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent,
    { type: 'plan:start', query: 'Q1', mode: 'flat' } as WorkflowEvent,
    { type: 'plan', intent: 'clarify', tasks: [], clarifyQuestions: ['which?'], tokenCount: 5, timeMs: 50 } as WorkflowEvent,
  ]);
  assert.equal(s.documents.get(A)!.phase, 'clarifying');
  const planBefore = s.documents.get(A)!.plan;
  // The pipeline re-emits query for the same doc — no wipe, no re-birth.
  s = fold([{ type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent], s);
  assert.equal(s.documents.size, 1);
  assert.equal(s.documents.get(A)!.plan, planBefore);
  assert.equal(s.runDocId, A);
});

test('warm ask: streams under the settled doc, settles as an exchange', () => {
  let s = fold([{ type: 'query', docId: A, query: 'follow-up?', warm: true, effort: 'high' } as WorkflowEvent], settled());
  const doc = s.documents.get(A)!;
  assert.equal(doc.query, 'Q1');
  assert.equal(doc.answer, 'the settled answer');
  assert.equal(doc.ask, 'follow-up?');
  assert.equal(doc.runEffort, 'high');
  assert.equal(s.runDocId, A);
  // research:start never leaves 'done' under an ask — the total rule.
  s = fold([
    { type: 'plan:start', query: 'follow-up?', mode: 'flat' } as WorkflowEvent,
    PLAN,
    { type: 'research:start', agentCount: 1, mode: 'flat' } as WorkflowEvent,
  ], s);
  assert.equal(s.documents.get(A)!.phase, 'done');
  assert.equal(selectStatus(s), 'Writing');
  // The answer lands as an exchange, clears the ask; complete clears the run.
  s = fold([{ type: 'answer', text: 'the follow-up answer' } as WorkflowEvent, COMPLETE], s);
  const settled2 = s.documents.get(A)!;
  assert.equal(settled2.ask, null);
  assert.equal(settled2.exchanges.length, 1);
  assert.equal(settled2.exchanges[0].question, 'follow-up?');
  assert.equal(settled2.answer, 'the settled answer');
  assert.equal(s.runDocId, null);
});

test('doc-switch isolation: the run streams into A while B is viewed, untouched', () => {
  let s = settled();
  // A settled doc B arrives from disk and is activated (view-only).
  s = fold([
    { type: 'doc', docId: B, title: 'B doc', mode: null, answer: 'b body', exchanges: [] } as WorkflowEvent,
    { type: 'doc:active', docId: B } as WorkflowEvent,
  ], s);
  // A warm ask starts on A (the run), while the canvas stays on B.
  s = fold([
    { type: 'query', docId: A, query: 'ask into A', warm: true } as WorkflowEvent,
    { type: 'doc:active', docId: B } as WorkflowEvent,
  ], s);
  const bBefore = s.documents.get(B)!;
  s = fold([
    { type: 'agent:spawn', agentId: 3, taskIndex: 0 } as WorkflowEvent,
    { type: 'agent:produce', agentId: 3, text: 'tokens for A', tokenCount: 4 } as WorkflowEvent,
  ], s);
  assert.equal(s.documents.get(B), bBefore); // reference-identical — untouched
  assert.ok(s.documents.get(A)!.agents.has(3)); // A accrued the stream
  assert.equal(s.activeDocId, B);
  assert.equal(s.runDocId, A);
});

test('doc upsert does not activate; activation is its own event', () => {
  let s = settled();
  s = fold([{ type: 'doc', docId: B, title: 'B doc', mode: 'flat', answer: 'b body', exchanges: [{ question: 'q', body: 'a', attachments: [] }] } as WorkflowEvent], s);
  assert.equal(s.activeDocId, A);
  const b = s.documents.get(B)!;
  assert.equal(b.phase, 'done');
  assert.equal(b.exchanges.length, 1);
  s = fold([{ type: 'doc:active', docId: B } as WorkflowEvent], s);
  assert.equal(s.activeDocId, B);
  s = fold([{ type: 'doc:active', docId: null } as WorkflowEvent], s);
  assert.equal(s.activeDocId, null); // the picker
});

test('disk never overwrites a running document', () => {
  // An ask runs on A; navigating back to A re-opens it from disk — the
  // upsert must not clobber the live state (the in-flight ask).
  let s = fold([{ type: 'query', docId: A, query: 'ask?', warm: true } as WorkflowEvent], settled());
  const live = s.documents.get(A)!;
  s = fold([
    { type: 'doc', docId: A, title: 'Q1', mode: null, answer: 'stale disk copy', exchanges: [] } as WorkflowEvent,
    { type: 'doc:active', docId: A } as WorkflowEvent,
  ], s);
  assert.equal(s.documents.get(A), live); // reference-identical — untouched
  assert.equal(s.documents.get(A)!.ask, 'ask?');
});

test('run:aborted: a stillborn doc dies to the picker; a settled doc stands', () => {
  // Stillborn: aborted during framing.
  let s = fold([
    { type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent,
    { type: 'run:aborted' } as WorkflowEvent,
  ]);
  assert.equal(s.documents.has(A), false);
  assert.equal(s.activeDocId, null);
  assert.equal(s.runDocId, null);
  // Standing: an aborted ask clears the ask, keeps the doc.
  s = fold([
    { type: 'query', docId: A, query: 'ask?', warm: true } as WorkflowEvent,
    { type: 'run:aborted' } as WorkflowEvent,
  ], settled());
  const doc = s.documents.get(A)!;
  assert.equal(doc.ask, null);
  assert.equal(doc.answer, 'the settled answer');
  assert.equal(s.runDocId, null);
});

test('ui:error is ONLY a toast — the document survives it', () => {
  // One event, one meaning: a benign failure (bad config path, failed
  // search) must not touch any document. A dying run announces itself with
  // run:aborted alongside — that event carries the abort, alone.
  let s = fold([
    { type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent,
    { type: 'ui:error', message: 'boom' } as WorkflowEvent,
  ]);
  assert.equal(s.documents.has(A), true);
  assert.equal(s.documents.get(A)!.phase, 'planning');
  assert.equal(s.session.toast?.message, 'boom');
  // The death of a run is run:aborted's job — both together abort AND toast.
  s = fold([{ type: 'run:aborted' } as WorkflowEvent], s);
  assert.equal(s.documents.has(A), false);
});

test('the moment and status tables are total over DocPhase', () => {
  for (const phase of DOC_PHASES) {
    let s = fold([{ type: 'query', docId: A, query: 'Q', warm: false } as WorkflowEvent]);
    const doc = { ...s.documents.get(A)!, phase };
    s = { ...s, documents: new Map([[A, doc]]) };
    assert.ok(['ask', 'frame', 'write', 'settle'].includes(selectMoment(s)), `moment total at ${phase}`);
    assert.ok(typeof selectStatus(s) === 'string' && selectStatus(s).length > 0, `status total at ${phase}`);
    assert.ok(typeof selectLive(s) === 'boolean', `live total at ${phase}`);
  }
});

test('stragglers: run events with no live run are dropped, never crash', () => {
  const s = fold([
    { type: 'agent:produce', agentId: 9, text: 'orphan', tokenCount: 1 } as WorkflowEvent,
    { type: 'research:start', agentCount: 1, mode: 'flat' } as WorkflowEvent,
  ], settled());
  assert.equal(s.documents.get(A)!.agents.size, settled().documents.get(A)!.agents.size);
});

test('a cold planned query reaches plan_review (the CLI contract)', () => {
  const s = fold([
    { type: 'query', docId: A, query: 'Q', warm: false } as WorkflowEvent,
    { type: 'plan:start', query: 'Q', mode: 'flat' } as WorkflowEvent,
    PLAN,
    { type: 'ui:plan_review' } as WorkflowEvent,
  ]);
  assert.equal(s.documents.get(A)!.phase, 'plan_review');
  assert.equal(selectReviewing(s), true);
});

test('a library restore settles with its exchanges via doc + doc:active', () => {
  const s = fold([
    { type: 'doc', docId: A, title: 'Reopened', mode: 'flat', answer: 'restored body', exchanges: [{ question: 'old q', body: 'old a', attachments: [] }] } as WorkflowEvent,
    { type: 'doc:active', docId: A } as WorkflowEvent,
  ]);
  assert.equal(selectMoment(s), 'settle');
  const a = selectAnswer(s);
  assert.ok(a && a.body.includes('restored body'));
  assert.equal(s.documents.get(A)!.exchanges.length, 1);
});

test('selectEtaTasks: honest per run phase, null at rest', () => {
  assert.equal(selectEtaTasks(settled()), null);
  let s = fold([
    { type: 'query', docId: B, query: 'Q2', warm: false } as WorkflowEvent,
    { type: 'plan:start', query: 'Q2', mode: 'flat' } as WorkflowEvent,
    PLAN,
    { type: 'ui:plan_review' } as WorkflowEvent,
  ], settled());
  assert.equal(selectEtaTasks(s), 2);
  s = fold([{ type: 'research:start', agentCount: 3, mode: 'flat' } as WorkflowEvent], s);
  assert.equal(selectEtaTasks(s), 3); // fork count is authoritative
});

test('selectRunDepth: the run keeps its own effort across preflight', () => {
  let s = fold([{ type: 'query', docId: A, query: 'Q', warm: false, effort: 'low' } as WorkflowEvent]);
  assert.equal(selectRunDepth(s), 'low');
  s = fold([{ type: 'preflight:start', query: 'Q', abilityCount: 2 } as WorkflowEvent], s);
  assert.equal(s.documents.get(A)!.runEffort, 'low');
});
