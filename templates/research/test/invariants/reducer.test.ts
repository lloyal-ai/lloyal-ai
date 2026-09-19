/**
 * Fold-level tests for document identity: birth, ask, activation, isolation,
 * abort, and the totality of the moment/status tables. Pure — real `reduce`,
 * real selectors, no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, initialState, type AppState } from '../../src/ui/state.js';
import type { WorkflowEvent } from '../../src/brief/protocol.js';
import {
  DOC_PHASES, selectAnswer, selectControls, selectEtaTasks, selectLive, selectMarks, selectMoment, selectReviewing,
  selectRunDepth, selectRunTitle, selectSections, selectStatus, selectTitle, selectProbes,
} from '../../src/ui/select.js';

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
    { type: 'ui:clarify', revision: 1 } as WorkflowEvent,
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

test('warm ask that found nothing: the ask ends, the question stands as an exchange with no body, the root answer is untouched', () => {
  const s = fold([
    { type: 'query', docId: A, query: 'follow-up?', warm: true } as WorkflowEvent,
    { type: 'research:start', agentCount: 1, mode: 'flat' } as WorkflowEvent,
    { type: 'answer', text: null } as WorkflowEvent,
    COMPLETE,
  ], settled());
  const doc = s.documents.get(A)!;
  assert.equal(doc.ask, null);
  assert.deepEqual(doc.exchanges, [{ question: 'follow-up?', body: null, attachments: [] }]);
  assert.equal(doc.answer, 'the settled answer');
  assert.equal(doc.phase, 'done');
});

test('doc-switch isolation: the run streams into A while B is viewed, untouched', () => {
  let s = settled();
  // A settled doc B arrives from disk and is activated (view-only).
  s = fold([
    { type: 'doc', docId: B, title: 'B doc', mode: 'flat', effort: 'low', direct: false, answer: 'b body', exchanges: [] } as WorkflowEvent,
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
  assert.ok(s.documents.get(A)!.roster.agents.has(3)); // A accrued the stream
  assert.equal(s.activeDocId, B);
  assert.equal(s.runDocId, A);
});

test('doc upsert does not activate; activation is its own event', () => {
  let s = settled();
  s = fold([{ type: 'doc', docId: B, title: 'B doc', mode: 'flat', effort: 'low', direct: false, answer: 'b body', exchanges: [{ question: 'q', body: 'a', attachments: [] }] } as WorkflowEvent], s);
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
    { type: 'doc', docId: A, title: 'Q1', mode: 'flat', effort: 'low', direct: false, answer: 'stale disk copy', exchanges: [] } as WorkflowEvent,
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
  assert.equal(s.documents.get(A)!.roster.agents.size, settled().documents.get(A)!.roster.agents.size);
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
    { type: 'doc', docId: A, title: 'Reopened', mode: 'flat', effort: 'low', direct: false, answer: 'restored body', exchanges: [{ question: 'old q', body: 'old a', attachments: [] }] } as WorkflowEvent,
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

test('a probe wears the name of the source it probes, read off its spawn key — never its place in the byline', () => {
  // The byline lists every installed source, corpus first and off by default; the pool forks one probe per
  // PARTICIPATING source, in its own order. Aligning the two by position labels the web probe "corpus".
  const ability = (name: string, enabled: boolean) => ({ name, enabled, config: {}, configSchema: undefined, iconUrl: null });
  let s = fold([
    { type: 'abilities:state', abilities: [ability('corpus', false), ability('web', true), ability('documents', true)] } as unknown as WorkflowEvent,
    { type: 'query', docId: A, query: 'Q', warm: false, effort: 'low' } as WorkflowEvent,
    { type: 'plan:start', query: 'Q', mode: 'flat' } as WorkflowEvent,
    { type: 'preflight:start', query: 'Q', abilityCount: 2 } as WorkflowEvent,
    { type: 'agent:spawn', agentId: 1, parentAgentId: null, key: 'source:web' } as WorkflowEvent,
    { type: 'agent:spawn', agentId: 2, parentAgentId: null, key: 'source:documents' } as WorkflowEvent,
  ]);
  assert.deepEqual(selectProbes(s).map((p) => p.title), ['web', 'documents']);
});

// ── Admissions grow the thread live ────────────────────────────
// A tool result that admitted roots reaches the fold on the bus as
// `agent:prefilled`; the roots join the ask (or the brief) as they land, so the
// strip shows what the model saw before the answer settles and without a reopen.
const PAGE = { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: 'sha256:' + 'c'.repeat(64), size: 700 };
const PAGE2 = { ...PAGE, digest: 'sha256:' + 'd'.repeat(64) };
const admitted = (roots: unknown[]) =>
  ({ type: 'agent:prefilled', agentId: 3, cells: 1629, role: 'toolResult', attachments: roots }) as WorkflowEvent;

test('a warm ask grows its attachments as a tool admits roots, once each, and settles them into the exchange', () => {
  let s = fold([
    { type: 'query', docId: A, query: 'the figure?', warm: true } as WorkflowEvent,
    { type: 'research:start', agentCount: 1, mode: 'flat' } as WorkflowEvent,
    admitted([PAGE]),
  ], settled());
  assert.deepEqual(s.documents.get(A)!.askAttachments, [PAGE.digest]);
  // A heal replays the same admission; a second tool admits another root.
  s = fold([admitted([PAGE]), admitted([PAGE2, PAGE])], s);
  assert.deepEqual(s.documents.get(A)!.askAttachments, [PAGE.digest, PAGE2.digest]);
  s = fold([{ type: 'answer', text: 'it shows…' } as WorkflowEvent, COMPLETE], s);
  const doc = s.documents.get(A)!;
  assert.deepEqual(doc.askAttachments, []);
  assert.deepEqual(doc.exchanges[0].attachments, [PAGE.digest, PAGE2.digest]);
  // The brief's own media is untouched by what an ask admitted.
  assert.deepEqual(doc.attachments, []);
});

test("a cold brief grows its own media as a tool admits roots; a prefill without roots changes nothing", () => {
  let s = fold([
    { type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent,
    { type: 'research:start', agentCount: 1, mode: 'flat' } as WorkflowEvent,
    { type: 'agent:prefilled', agentId: 3, cells: 40, role: 'toolResult' } as WorkflowEvent,
  ]);
  assert.deepEqual(s.documents.get(A)!.attachments, []);
  s = fold([admitted([PAGE]), admitted([PAGE])], s);
  assert.deepEqual(s.documents.get(A)!.attachments.map((a) => a.digest), [PAGE.digest]);
  assert.deepEqual(s.documents.get(A)!.askAttachments, []);
});


// ── A task is logical; an agent is one attempt at it ───────────
// The pool names each spawn with its task's key and may seat them in any
// order; a heal is a NEW agent under the SAME key. What the reader sees is
// the task — worked by whichever attempt is the current one.

test('a healed inquiry is the section the reader reads, and the brief is not marked unsettled', () => {
  const s = fold([
    { type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent,
    { type: 'plan:start', query: 'Q1', mode: 'flat' } as WorkflowEvent,
    { type: 'plan', intent: 'research', tasks: [{ description: 'the near half' }, { description: 'the far half' }], clarifyQuestions: [], tokenCount: 1, timeMs: 1 } as WorkflowEvent,
    { type: 'research:start', agentCount: 2, mode: 'flat' } as WorkflowEvent,
    // Admission reorders: the far task seats first.
    { type: 'agent:spawn', agentId: 21, key: 'task:1' } as WorkflowEvent,
    { type: 'agent:spawn', agentId: 20, key: 'task:0' } as WorkflowEvent,
    // The near task's first attempt dies; the pool spawns its replacement under the same key.
    { type: 'agent:failed', agentId: 20, reason: 'decode_error' } as WorkflowEvent,
    { type: 'agent:spawn', agentId: 22, key: 'task:0' } as WorkflowEvent,
    { type: 'agent:return', agentId: 22, result: 'near findings, second attempt' } as WorkflowEvent,
    { type: 'agent:return', agentId: 21, result: 'far findings' } as WorkflowEvent,
    { type: 'answer', text: 'the settled answer' } as WorkflowEvent,
    COMPLETE,
  ]);
  const sections = selectSections(s);
  assert.deepEqual(sections.map((x) => x.title), ['the near half', 'the far half']);
  assert.equal(sections[0].prose, 'near findings, second attempt', "the healed attempt's findings are the section");
  assert.equal(sections[0].inquiry?.verb.kind, 'settled');
  assert.equal(sections[1].prose, 'far findings', 'the key names the task, not the order it was admitted in');
  assert.deepEqual(selectMarks(s), [], 'nothing closed unsettled: every task has a settled attempt');
  // The attempt that died is still there for the dev pane — only the section stopped reading it.
  assert.equal(s.documents.get(A)!.roster.agents.get(20)!.failReason, 'decode_error');
});

test("an ordinary tool that shares the findings' argument name is a step of the work, never the findings", () => {
  // The inquiries hand in with `finish(body)`; `write_file(body)` is just a tool they may call. The argument's
  // name cannot tell the two apart — only the tool's can.
  const base = fold([
    { type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent,
    { type: 'plan:start', query: 'Q1', mode: 'flat' } as WorkflowEvent,
    { type: 'plan', intent: 'research', tasks: [{ description: 'the only task' }], clarifyQuestions: [], tokenCount: 1, timeMs: 1 } as WorkflowEvent,
    { type: 'research:start', agentCount: 1, mode: 'flat', reports: { tool: 'finish', field: 'body' } } as WorkflowEvent,
    { type: 'agent:spawn', agentId: 20, key: 'task:0' } as WorkflowEvent,
    { type: 'agent:produce', agentId: 20, text: 'planning</think>', tokenCount: 1 } as WorkflowEvent,
    { type: 'agent:produce', agentId: 20, text: '<tool_call>\n<function=write_file>\n<parameter=body>\nFILE CONTENTS', tokenCount: 9 } as WorkflowEvent,
  ]);
  const [writingAFile] = selectSections(base);
  assert.equal(writingAFile.prose, null, "a file's contents were shown as the section's findings");
  assert.notEqual(writingAFile.inquiry?.verb.kind, 'writing', 'the inquiry was said to be writing its section while it wrote a file');

  const called = fold([{ type: 'agent:tool_call', agentId: 20, tool: 'write_file', args: '{"path":"notes.md"}' } as WorkflowEvent], base);
  const steps = called.documents.get(A)!.roster.agents.get(20)!.timeline!.filter((t) => t.kind === 'tool_call');
  assert.equal(steps.length, 1, 'the write_file call vanished from the work the reader can open');

  const finishing = fold([
    { type: 'agent:tool_result', agentId: 20, tool: 'write_file', result: '{}' } as WorkflowEvent,
    { type: 'agent:produce', agentId: 20, text: 'done</think>', tokenCount: 12 } as WorkflowEvent,
    { type: 'agent:produce', agentId: 20, text: '<tool_call>\n<function=finish>\n<parameter=body>\nTHE FINDINGS', tokenCount: 20 } as WorkflowEvent,
  ], called);
  const [handingIn] = selectSections(finishing);
  assert.equal(handingIn.prose, 'THE FINDINGS');
  assert.equal(handingIn.streaming, true);
});

test("the run bar commands the RUNNING document while the canvas shows another", () => {
  // Run A pauses; the user opens settled B from the library. `live` reads the
  // run document, so the controls beside it must too — or Hold reads B's
  // `paused: false` and sends `pause` to a run that is already paused.
  const s = fold([
    { type: 'query', docId: A, query: 'Q1', warm: false } as WorkflowEvent,
    { type: 'plan:start', query: 'Q1', mode: 'flat' } as WorkflowEvent,
    PLAN,
    { type: 'research:start', agentCount: 2, mode: 'flat' } as WorkflowEvent,
    { type: 'run:paused' } as WorkflowEvent,
    { type: 'doc', docId: B, title: 'Saved brief', answer: 'The saved body.', mode: 'flat', savedAt: B, attachments: [], exchanges: [] } as unknown as WorkflowEvent,
    { type: 'doc:active', docId: B } as WorkflowEvent,
  ]);
  assert.equal(s.runDocId, A);
  assert.equal(s.activeDocId, B);
  assert.equal(selectLive(s), true);
  assert.equal(selectControls(s).paused, true, "Hold must read the running document's pause");
  assert.equal(selectStatus(s), 'Writing', "the status word describes the running document");
  assert.equal(selectRunTitle(s), 'Q1', "the run bar names the running document");
  assert.equal(selectTitle(s), 'Saved brief', "the canvas keeps the viewed document");
});
