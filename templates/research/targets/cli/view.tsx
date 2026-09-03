/**
 * The terminal view — a `render`-style binding: `(bus, dispatch, bootstrap) =>
 * dispose`. It subscribes to your events, folds them through the REAL research
 * `reduce` (harness/state.ts), and renders an austere slice of the rich
 * `AppState`: the phase, the live agents, a KV gauge, and the streaming answer.
 *
 * Austere on purpose. reasoning.run's own UI is a 19-component Ink suite with a
 * plan-review editor, a sources ledger, and a settings drawer; this view folds
 * the SAME state through a handful of lines. It auto-accepts the planner's plan
 * (no interactive plan-review here) so a query runs recon → plan → agents →
 * synth end-to-end. Swap it, or grow it, or bring a whole app — the harness
 * never changes; the framework holds the binding seam, never the UI.
 */
import React, { useEffect, useReducer, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import type { EventBus } from "@lloyal-labs/binding";
import { initialState, reduce } from "../../harness/state.js";
import type { AgentRuntime, AppState } from "../../harness/state.js";
import type { Command, WorkflowEvent } from "../../harness/protocol.js";
import { DevOverlay } from "@lloyal-labs/dev-tools/ink";
import { createPaneModel, foldEvent } from "@lloyal-labs/dev-tools";

const seed = (bootstrap: WorkflowEvent[]): AppState =>
  bootstrap.reduce(reduce, initialState);

const glyph = (p: AgentRuntime["phase"]): string =>
  p === "done" ? "✓" : p === "failed" ? "✗" : p === "tool" ? "◍" : p === "idle" ? "·" : "●";

/** The document this austere view renders: the running one, else whatever
 *  the canvas last activated. One derivation — the CLI never holds doc
 *  state of its own. */
const docOf = (state: AppState) =>
  (state.runDocId !== null ? state.documents.get(state.runDocId) : undefined) ??
  (state.activeDocId !== null ? state.documents.get(state.activeDocId) : undefined) ??
  null;

function Gauge({ used, total }: { used: number; total: number }): React.ReactElement | null {
  if (!total) return null;
  const pct = Math.min(100, Math.round((100 * used) / total));
  const width = 16;
  const filled = Math.round((pct / 100) * width);
  return (
    <Text color="gray">
      KV {"█".repeat(filled)}
      {"░".repeat(width - filled)} {pct}%
    </Text>
  );
}

function View({
  bus,
  dispatch,
  bootstrap,
}: {
  bus: EventBus<WorkflowEvent>;
  dispatch: (c: Command) => void;
  bootstrap: WorkflowEvent[];
}): React.ReactElement {
  const [state, apply] = useReducer(reduce, bootstrap, seed);
  const app = useApp();
  const acceptedRef = useRef(false);

  // The dev overlay's model + a SHORT formatted tail — folded alongside the
  // view's own reduce from the same subscription. The overlay renders nothing
  // unless config:loaded carried dev: true (LLOYAL_DEV).
  // Lazy init: an inline initializer would allocate a fresh model every
  // render only to be discarded after the first.
  const devModelRef = useRef<ReturnType<typeof createPaneModel> | null>(null);
  devModelRef.current ??= createPaneModel();
  const devModel = devModelRef.current;
  const devTail = useRef<string[]>([]);
  const [devOpen, setDevOpen] = useState(false);

  useEffect(() => bus.subscribe((ev) => {
    // Truly wire-gated: only config:loaded can flip the gate, so until it
    // says dev, the ONLY event folded is config:loaded itself — a non-dev
    // run never pays the per-token fold.
    if (devModel.dev || ev.type === "config:loaded") {
      foldEvent(devModel, ev as unknown as Record<string, unknown> & { type: string }, Date.now());
      if (devModel.dev && ev.type !== "agent:produce" && ev.type !== "agent:tick") {
        devTail.current.push(ev.type);
        if (devTail.current.length > 24) devTail.current.shift();
      }
    }
    apply(ev);
  }), [bus]);

  // Auto-accept the planner's plan — this austere view has no plan-review editor,
  // so a query flows straight through to research. `acceptedRef` de-bounces the
  // one transition into `plan_review`.
  const doc = docOf(state);
  const docPhase = doc?.phase ?? null;
  useEffect(() => {
    if (docPhase === "plan_review" && !acceptedRef.current) {
      acceptedRef.current = true;
      dispatch({ type: "accept_plan" });
    }
    if (docPhase !== "plan_review") acceptedRef.current = false;
  }, [docPhase, dispatch]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      dispatch({ type: "quit" });
      app.exit();
    }
    if (key.ctrl && input === "g") setDevOpen((v) => !v);
  });

  // Recon + research agents (skip the tool-less synth agent — taskIndex null).
  const agents = doc ? [...doc.agents.values()].filter((a) => a.taskIndex !== null) : [];

  // The streaming answer: the live synth buffer, else the finalized answer,
  // else the latest exchange's body. The doc is the memory.
  const streaming = doc
    ? (doc.synth.open && doc.synth.buffer) ||
      (doc.ask === null && doc.exchanges.length > 0
        ? doc.exchanges[doc.exchanges.length - 1].body
        : "") ||
      doc.answer ||
      ""
    : "";

  // Input is offered when nothing is mid-flight: no doc, a settled doc, or
  // the planner waiting on a clarification.
  const canInput = !doc || doc.phase === "done" || doc.phase === "clarifying";

  const onSubmit = (q: string): void => {
    const text = q.trim();
    if (!text) return;
    if (doc?.phase === "clarifying") {
      dispatch({ type: "submit_clarification", answer: text });
    } else {
      // The run mode comes from the loaded config default (`config:loaded`
      // seeds `session.config`); this austere view has no mode toggle.
      // A settled document makes the next submit an ask into it — the same
      // rule the Composer applies; warm planned queries do not exist.
      dispatch({
        type: "submit_query",
        query: text,
        mode: state.session.config?.defaults.reasoningMode ?? "flat",
        skipPlanner: doc?.answer != null,
      });
    }
  };

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{"__NAME__"}</Text>
        <Text color="gray">Model      resident · no API key</Text>
        <Text color="gray">Inference  local · no provider</Text>
        <Text color="gray">
          Phase      {docPhase ?? state.session.phase}
        </Text>
      </Box>

      {agents.length > 0 && (
        <Box flexDirection="column">
          {agents.map((a) => (
            <Text key={a.id}>
              {glyph(a.phase)} {a.label}
              {a.taskDescription ? ` · ${a.taskDescription}` : ""} · {a.tokenCount} tok
              {a.toolCallCount > 0 ? ` · ${a.toolCallCount} tools` : ""}
            </Text>
          ))}
          {state.session.pressure && (
            <Gauge used={state.session.pressure.cellsUsed} total={state.session.pressure.nCtx} />
          )}
        </Box>
      )}

      {docPhase === "clarifying" && doc?.plan?.clarifyQuestions?.length ? (
        <Box flexDirection="column">
          <Text color="yellow">The planner needs to clarify:</Text>
          {doc.plan.clarifyQuestions.map((q, i) => (
            <Text key={i} color="yellow">
              {"  "}
              {i + 1}. {q}
            </Text>
          ))}
        </Box>
      ) : null}

      {streaming ? <Text color="cyan">{streaming}</Text> : null}
      {state.session.toast?.tone === "error" && (
        <Text color="red">error: {state.session.toast.message}</Text>
      )}

      {devOpen && <DevOverlay model={devModel} tail={devTail.current} />}

      {canInput && (
        <Box>
          <Text color="green">› </Text>
          <TextInput
            placeholder={
              docPhase === "clarifying"
                ? "answer the planner, ctrl-c to stop"
                : "type a question, ctrl-c to stop"
            }
            onSubmit={onSubmit}
          />
        </Box>
      )}
    </Box>
  );
}

export function renderCli(
  bus: EventBus<WorkflowEvent>,
  dispatch: (c: Command) => void,
  bootstrap: WorkflowEvent[],
): () => void {
  const instance = render(<View bus={bus} dispatch={dispatch} bootstrap={bootstrap} />);
  return () => instance.unmount();
}
