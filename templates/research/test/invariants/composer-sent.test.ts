/**
 * A sent ask is held, draft and attachments with it, until the fold says what
 * became of it. A refusal (an attachment too large for the context, say) is an
 * error notice and nothing else, so it hands the draft back to be edited or
 * discarded; it is never lost with the send.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import { sentFate as fateOf, type Sent } from "../../src/ui/select.js";
import type { WorkflowEvent } from "../../src/protocol.js";

/** The facts the composer projects, read off a whole state. */
const sentFate = (s: Sent, app: AppState) => {
  const doc = app.activeDocId !== null ? app.documents.get(app.activeDocId) : undefined;
  return fateOf(s, {
    activeDocId: app.activeDocId, asks: doc?.asks ?? 0,
    clarifying: doc?.phase === "clarifying", notice: app.session.toast,
  });
};

/** An ask as the composer sends it from `app`: into the active document, at its count and the notice current then. */
const sent = (over: Partial<Sent> = {}, app: AppState = initialState): Sent => ({
  text: "What happens next?", docId: app.activeDocId, clarify: false,
  asks: app.activeDocId !== null ? app.documents.get(app.activeDocId)?.asks ?? 0 : 0,
  notice: app.session.nextToastId, ...over,
});
const refused = (from: AppState = initialState): AppState =>
  reduce(from, { type: "ui:error", message: "That attachment would take 17,600 tokens" });

const A = "2026-10-16T10-00-00-000";
const COMPLETE = { type: "complete", data: { wallTimeMs: 1, planMs: 0, researchMs: 0, synthMs: 0, passthroughMs: 0 } } as WorkflowEvent;
/** A brief that ran to its end: with an answer, or with none when the context had no room for one. */
const ran = (answer: string | null): AppState => ([
  { type: "query", docId: A, query: "Q1", warm: false },
  { type: "plan:start", query: "Q1", mode: "flat" },
  { type: "research:start", agentCount: 1, mode: "flat" },
  { type: "answer", text: answer, ...(answer === null ? { unanswered: "no_room" } : {}) },
  COMPLETE,
] as WorkflowEvent[]).reduce(reduce, initialState);
const echoed = (from: AppState, text: string): AppState =>
  reduce(from, { type: "query", docId: A, query: text, warm: true } as WorkflowEvent);

test("an ask with nothing back yet is waiting", () => {
  assert.equal(sentFate(sent(), initialState), "waiting");
});

test("an error notice after the send is its refusal", () => {
  assert.equal(sentFate(sent(), refused()), "refused");
});

test("a notice from before the send is not its refusal", () => {
  const before = refused();
  assert.equal(sentFate(sent({ notice: before.session.nextToastId }), before), "waiting");
});

test("a document born or activated acknowledges it, whatever notices follow", () => {
  const born: AppState = { ...refused(), activeDocId: "doc-1" };
  assert.equal(sentFate(sent(), born), "acknowledged");
});

test("a follow-up into a brief that kept no answer is acknowledged by its echo, whatever notices follow", () => {
  // The host accepts the ask and the fold re-births the document under the same id with no `ask` set: the
  // document took the ask all the same, and an unrelated error arriving before the run ends must not hand
  // the question back as refused.
  const before = ran(null);
  const s = sent({ text: "Try again" }, before);
  assert.equal(sentFate(s, before), "waiting");
  const after = echoed(before, "Try again");
  assert.equal(sentFate(s, after), "acknowledged");
  assert.equal(sentFate(s, refused(after)), "acknowledged");
});

test("a repeat of the brief's own question is acknowledged only when the host echoes it", () => {
  // The words alone cannot say the host took it: the document's title is already these words.
  const before = ran("the settled answer");
  const s = sent({ text: "Q1" }, before);
  assert.equal(sentFate(s, before), "waiting");
  assert.equal(sentFate(s, refused(before)), "refused");
  assert.equal(sentFate(s, echoed(before, "Q1")), "acknowledged");
});

test("a success notice after the send is not a refusal", () => {
  const saved: AppState = {
    ...initialState,
    session: { ...initialState.session, toast: { id: 1, message: "saved", tone: "success" }, nextToastId: 1 },
  };
  assert.equal(sentFate(sent(), saved), "waiting");
});
