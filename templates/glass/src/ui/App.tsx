import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useConnection,
  useProjection,
  useRecover,
  useSend,
} from "@lloyal-labs/ui";
import type { AppState } from "./state.js";
import type { Command } from "../protocol.js";
import { activeConversation, isWorking, streamedAnswer } from "./select.js";
import { ActionMenu } from "./parts/ActionMenu.js";
import { Composer } from "./parts/Composer.js";
import { ActivityLabel } from "./parts/ActivityLabel.js";
import { PendingActivity } from "./parts/PendingActivity.js";
import { History } from "./parts/History.js";
import { LiveField } from "./parts/LiveField.js";
import { Evidence } from "./parts/Evidence.js";
import { Work } from "./parts/Work.js";
import { AnswerView } from "./parts/Answer.js";
import type { Selection } from "../domain/answer.js";
import "./glass.css";
import { PreferencesProvider, usePreferences } from "./preferences.js";

class ViewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="glass-view-error">
        <h1>The view could not open.</h1>
        <p>Your saved conversations remain on the host.</p>
        <button onClick={() => window.location.reload()}>Reload Glass</button>
      </main>
    ) : (
      this.props.children
    );
  }
}

export function HarnessApp() {
  return (
    <ViewBoundary>
      <PreferencesProvider>
        <GlassApp />
      </PreferencesProvider>
    </ViewBoundary>
  );
}
function GlassApp() {
  const { value: preferences } = usePreferences();
  const state = useProjection((s: AppState) => s);
  const send = useSend<Command>();
  const connection = useConnection();
  const recover = useRecover();
  const [selection, setSelection] = useState<Selection | null>(null);
  useEffect(() => setSelection(null), [state.activeId]);
  const [nav, setNav] = useState(false);
  const scroll = useRef<HTMLElement>(null),
    positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    if (scroll.current)
      scroll.current.scrollTop =
        positions.current.get(state.activeId ?? "new") ?? 0;
  }, [state.activeId]);
  const menu = useRef<HTMLButtonElement>(null);
  const record = activeConversation(state);
  const lastTurn = record?.turns.at(-1)?.id;
  const previousTurn = useRef({ conversation: state.activeId, turn: lastTurn });
  useLayoutEffect(() => {
    const previous = previousTurn.current;
    // Acknowledged new turns come into view once. Streaming never moves a reader,
    // and navigating to history retains the scroll position restored above.
    if (
      previous.conversation === state.activeId &&
      previous.turn &&
      lastTurn &&
      previous.turn !== lastTurn
    ) {
      scroll.current
        ?.querySelector<HTMLElement>(`[data-turn="${lastTurn}"]`)
        ?.scrollIntoView({ block: "start" });
    }
    previousTurn.current = { conversation: state.activeId, turn: lastTurn };
  }, [state.activeId, lastTurn]);
  const work = state.work;
  const busy = isWorking(state);
  const draft = streamedAnswer(state);
  useEffect(() => {
    send({ type: "list_conversations" });
  }, [send]);
  useEffect(() => {
    document.title = record ? record.title + " · Glass" : "Glass";
  }, [record?.title]);
  function closeNav() {
    setNav(false);
    menu.current?.focus();
  }
  return (
    <div
      id="glass-composition"
      data-motion={preferences.motion}
      data-nav={nav ? "open" : "closed"}
      data-view={record ? "conversation" : "arrival"}
      data-working={busy && !work?.paused}
    >
      <div className="gc-app">
        <div className="gc-haze" />
        <LiveField state={state} />
        <button
          ref={menu}
          type="button"
          className="gc-menu gc-icon gc-nav-trigger"
          aria-label="Open history"
          aria-expanded={nav}
          inert={nav}
          onClick={() => setNav((v) => !v)}
        >
          <span />
          <span />
        </button>
        <History open={nav} close={closeNav} />
        <header className="gc-header" inert={nav}>
          <span className="gc-thread-title">{record?.title}</span>
          <span className="gc-spacer" />
          {busy && (
            <div className="gc-run-controls">
              {work?.conversationId !== state.activeId && (
                <button
                  type="button"
                  onClick={() =>
                    send({
                      type: "open_conversation",
                      id: work!.conversationId,
                    })
                  }
                >
                  Back to current work
                </button>
              )}
              <span role="status">
                <ActivityLabel
                  active={
                    !work?.paused &&
                    !["review", "stopping"].includes(work?.phase ?? "")
                  }
                >
                  {work?.phase === "stopping"
                    ? "Stopping…"
                    : work?.paused
                      ? "Paused"
                      : work?.phase === "restoring"
                        ? "Reopening…"
                        : work?.phase === "review"
                          ? "Review the approach"
                          : work?.phase === "answering"
                            ? "Writing"
                            : work?.phase === "deciding"
                              ? "Considering the request"
                              : work?.phase === "preflight"
                                ? "Checking source coverage"
                                : "Working"}
                </ActivityLabel>
              </span>
              <button
                type="button"
                disabled={work?.phase === "stopping"}
                onClick={() =>
                  send({ type: work?.paused ? "resume" : "pause" })
                }
              >
                {work?.paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                disabled={
                  work?.paused ||
                  work?.phase === "stopping" ||
                  work?.phase === "restoring"
                }
                title={work?.paused ? "Resume before finishing" : undefined}
                onClick={() =>
                  send({ type: "finish_work", turnId: work!.turnId })
                }
              >
                Finish
              </button>
              <button
                type="button"
                disabled={work?.phase === "stopping"}
                onClick={() => send({ type: "stop" })}
              >
                Stop
              </button>
            </div>
          )}
        </header>
        <div className="gc-stage" inert={nav}>
          <main
            ref={scroll}
            className="gc-scroll"
            onScroll={(e) =>
              positions.current.set(
                state.activeId ?? "new",
                e.currentTarget.scrollTop,
              )
            }
          >
            <div className="gc-layout">
              <div className="gc-main">
                {connection !== "connected" && (
                  <div className="gc-notice" role="status">
                    Connection: {connection}{" "}
                    {recover && (
                      <button type="button" onClick={recover}>
                        Reconnect
                      </button>
                    )}
                  </div>
                )}
                {state.error && (
                  <div className="gc-notice" role="alert">
                    {state.error}
                  </div>
                )}
                {!record && (
                  <section className="gc-arrival">
                    <h1>What’s on your mind?</h1>
                  </section>
                )}
                {record?.turns.map((turn) => {
                  const stream =
                    turn.id === work?.turnId &&
                    record.id === work.conversationId
                      ? draft
                      : "";
                  const body = turn.answer ?? stream;
                  return (
                    <section
                      key={turn.id}
                      data-turn={turn.id}
                      className="gc-exchange"
                    >
                      <div className="gc-question">
                        <p>{turn.question}</p>
                        {turn.mode && turn.mode !== "Auto" && (
                          <span className="gc-mode-receipt">{turn.mode}</span>
                        )}
                      </div>
                      {(turn.directions ?? []).map((d) => (
                        <p className="gc-direction" key={d.id}>
                          {d.query}
                        </p>
                      ))}
                      <Evidence
                        roots={turn.attachments}
                        references={record.turns.flatMap((t) => t.attachments)}
                        viewed={
                          turn.id === work?.turnId ? work.viewed : turn.viewed
                        }
                      />
                      {work?.turnId === turn.id && work.plan && (
                        <Work key={work.turnId} />
                      )}
                      {busy &&
                        work?.conversationId === record.id &&
                        work.turnId === turn.id &&
                        turn.status === "pending" &&
                        !body &&
                        (!work?.plan || work.phase === "answering") && (
                          <PendingActivity
                            paused={work?.paused || work?.phase === "stopping"}
                            label={
                              work?.paused
                                ? "Paused"
                                : work?.phase === "stopping"
                                  ? "Stopping…"
                                  : work?.phase === "deciding"
                                    ? "Considering your request"
                                    : work?.phase === "preflight"
                                      ? "Checking sources"
                                      : "Preparing your answer"
                            }
                          />
                        )}
                      <AnswerView
                        actions={
                          !busy ? (
                            <ActionMenu
                              label="Answer actions"
                              action="Discard turn"
                              onAction={() => {
                                if (
                                  confirm(
                                    "Discard this question and its answer? Later turns will stay saved.",
                                  )
                                )
                                  send({
                                    type: "discard_turn",
                                    id: record.id,
                                    turnId: turn.id,
                                    revision: record.revision,
                                  });
                              }}
                            />
                          ) : null
                        }
                        recordId={record.id}
                        revision={record.revision}
                        mutable={!busy}
                        turn={turn}
                        stream={stream}
                        digests={record.turns.flatMap((t) =>
                          t.attachments.map((a) => a.digest),
                        )}
                        selected={
                          selection?.turnId === turn.id
                            ? selection
                            : record.turns
                                .map((t) => t.selection)
                                .reverse()
                                .find((s) => s?.turnId === turn.id)
                        }
                        onSelect={(s) => {
                          setSelection(s);
                          document
                            .querySelector<HTMLTextAreaElement>(".gc-input")
                            ?.focus();
                        }}
                      />
                      {turn.status !== "complete" &&
                        turn.status !== "pending" && (
                          <div className="gc-interruption">
                            <span>
                              {turn.status === "partial"
                                ? "Partial answer · saved"
                                : (turn.reason ?? "No answer was saved.")}
                            </span>
                            {!busy && (
                              <button
                                className="gc-small"
                                onClick={() =>
                                  send({
                                    type: "continue_conversation",
                                    id: record.id,
                                    turnId: turn.id,
                                    revision: record.revision,
                                  })
                                }
                              >
                                Continue
                              </button>
                            )}
                            {stream && !turn.answer && !busy && (
                              <button
                                className="gc-small"
                                type="button"
                                onClick={() =>
                                  send({
                                    type: "keep_partial",
                                    id: record.id,
                                    turnId: turn.id,
                                    revision: record.revision,
                                  })
                                }
                              >
                                Keep this draft
                              </button>
                            )}
                          </div>
                        )}
                    </section>
                  );
                })}
              </div>
            </div>
          </main>
          <Composer
            selection={selection}
            onClear={() => setSelection(null)}
            onSelect={setSelection}
          />
        </div>
      </div>
    </div>
  );
}
