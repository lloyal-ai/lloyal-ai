/**
 * The terminal view. It subscribes to the same events and folds them through the same `reduce` as the desktop
 * and browser views, then renders a few lines of that state: the phase, the live agents, how full the context
 * is, and the answer as it streams.
 *
 * Austere on purpose — the same state carries the whole product interface. It accepts the planner's plan at
 * once, because it has no plan editor, so a question runs end to end. Swap it, grow it, or bring your own: the
 * harness does not change, and the framework owns the binding, never the view.
 */
import React, { useEffect, useReducer, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import type { EventBus } from "@lloyal-labs/binding";
import { initialState, reduce } from "./state.js";
import type { AgentRuntime, AppState } from "./state.js";
import { selectAnswer } from "./select.js";
import type { Command, WorkflowEvent } from "../protocol.js";
import { useDevOverlay } from "@lloyal-labs/dev-tools/ink";
import { APP, NOTHING_KEPT } from "./presentation.js";
import { FRAMING } from "./devtools.js";

const seed = (bootstrap: readonly WorkflowEvent[]): AppState =>
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
  bootstrap: readonly WorkflowEvent[];
}): React.ReactElement {
  const [state, apply] = useReducer(reduce, bootstrap, seed);
  const app = useApp();
  const acceptedRef = useRef(false);

  // The dev overlay: nothing unless the wire said dev (LLOYAL_DEV), ctrl+g to show it. The hook owns the rest.
  const dev = useDevOverlay(bus, { framing: FRAMING });

  useEffect(() => bus.subscribe(apply), [bus]);

  // Auto-accept the planner's plan — this austere view has no plan-review editor,
  // so a query flows straight through to research. `acceptedRef` de-bounces the
  // one transition into `plan_review`.
  const doc = docOf(state);
  const docPhase = doc?.phase ?? null;
  useEffect(() => {
    if (docPhase === "plan_review" && !acceptedRef.current) {
      acceptedRef.current = true;
      dispatch({ type: "accept_plan", revision: doc?.revision ?? 0 });
    }
    if (docPhase !== "plan_review") acceptedRef.current = false;
  }, [docPhase, dispatch]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      dispatch({ type: "quit" });
      app.exit();
    }
    if (key.ctrl && input === "g") dev.toggle();
  });

  // The agents at work on the reader's behalf: probes, inquiries and the settling pass — every agent the fold
  // keeps a timeline for.
  const agents = doc ? [...doc.roster.agents.values()].filter((a) => a.timeline !== null) : [];

  // The answer: as the settling pass writes it; else the latest exchange, once the ask is over; else the settled
  // answer. A follow-up or a brief that found nothing says so, the same words as every other view. The doc is
  // the memory.
  const answer = selectAnswer(state);
  const latest = doc && doc.ask === null ? doc.exchanges[doc.exchanges.length - 1] : undefined;
  const streaming =
    answer?.streaming ? answer.body
    : latest ? latest.body ?? NOTHING_KEPT
    : doc && doc.phase === "done" && doc.answer === null ? NOTHING_KEPT
    : answer?.body ?? "";

  // Input is offered when nothing is mid-flight: no doc, a settled doc, or
  // the planner waiting on a clarification.
  const canInput = !doc || doc.phase === "done" || doc.phase === "clarifying";

  const onSubmit = (q: string): void => {
    const text = q.trim();
    if (!text) return;
    if (doc?.phase === "clarifying") {
      dispatch({ type: "submit_clarification", revision: doc?.revision ?? 0, answer: text });
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
        <Text bold>{APP.name}</Text>
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

      {dev.overlay}

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
  bootstrap: readonly WorkflowEvent[],
  streams: { stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream } = {},   // the terminal's, unless a test brings its own
): () => void {
  // ctrl+c is the app's to handle — it says `quit` on the wire so the harness ends and the process with it. Left
  // to Ink, ctrl+c unmounts the view and nothing tells the harness, which waits for a command that never comes.
  const instance = render(<View bus={bus} dispatch={dispatch} bootstrap={bootstrap} />, { ...streams, exitOnCtrlC: false });
  return () => instance.unmount();
}
