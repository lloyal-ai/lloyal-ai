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

/** The facts the composer projects, read off a whole state. */
const sentFate = (s: Sent, app: AppState) => {
  const doc = app.activeDocId !== null ? app.documents.get(app.activeDocId) : undefined;
  return fateOf(s, {
    activeDocId: app.activeDocId, ask: doc?.ask ?? null,
    clarifying: doc?.phase === "clarifying", notice: app.session.toast,
  });
};

const sent = (over: Partial<Sent> = {}): Sent =>
  ({ text: "What happens next?", docId: null, clarify: false, notice: initialState.session.nextToastId, ...over });
const refused = (from: AppState = initialState): AppState =>
  reduce(from, { type: "ui:error", message: "That attachment would take 17,600 tokens" });

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

test("a success notice after the send is not a refusal", () => {
  const saved: AppState = {
    ...initialState,
    session: { ...initialState.session, toast: { id: 1, message: "saved", tone: "success" }, nextToastId: 1 },
  };
  assert.equal(sentFate(sent(), saved), "waiting");
});
