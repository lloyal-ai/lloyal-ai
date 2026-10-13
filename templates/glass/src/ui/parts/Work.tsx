import { usePreferences } from "../preferences.js";
import { useEffect, useState } from "react";
import { useProjection, useSend } from "@lloyal-labs/ui";
import type { AppState } from "../state.js";
import type { Command } from "../../protocol.js";
import { validatePlan, type Plan, type WorkTask } from "../../domain/work.js";
import { agentText } from "../select.js";
import { StreamingProse, Prose } from "./Prose.js";
export function Work() {
  const { value: preferences } = usePreferences();
  const state = useProjection((s: AppState) => s),
    send = useSend<Command>(),
    work = state.work!,
    ps = work.plan!;
  const [editing, setEditing] = useState(ps.awaitingApproval),
    [draft, setDraft] = useState<Plan>(ps.plan),
    [selected, setSelected] = useState(ps.plan.tasks[0]?.id),
    [collapsed, setCollapsed] = useState(
      preferences.work === "compact" && !ps.awaitingApproval,
    ),
    [activity, setActivity] = useState(false),
    [dependencies, setDependencies] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(ps.plan);
    setEditing(ps.awaitingApproval);
    setError("");
  }, [ps.revision, ps.awaitingApproval]);
  useEffect(() => {
    setCollapsed(preferences.work === "compact" && !ps.awaitingApproval);
  }, [preferences.work, ps.awaitingApproval]);
  const live = work.phase !== "idle",
    locked = work.phase === "revising" || work.phase === "stopping";
  const active =
    ps.plan.tasks.find((t) => t.id === selected) ?? ps.plan.tasks[0];
  const runtime = (id: string) =>
    [...work.roster.agents.values()]
      .reverse()
      .find(
        (a) => work.keys[a.id] === id && work.revisions[a.id] === ps.revision,
      );
  const status = (id: string) => {
    if (ps.retained.includes(id) || work.outcomes[id]?.accepted)
      return "Complete";
    const a = runtime(id);
    if (work.outcomes[id]?.reason) return "No accepted result";
    if (!a) return live ? "Waiting" : "Not run";
    if (a.stopReason || a.failReason)
      return a.failReason ? "Failed" : "Stopped";
    if (a.phase === "done") return "Checking result";
    return work.paused
      ? "Paused"
      : a.phase === "tool"
        ? "Using a source"
        : a.phase === "thinking"
          ? "Thinking"
          : a.phase === "failed"
            ? "Failed"
            : "Working";
  };
  const patch = (id: string, p: Partial<WorkTask>) =>
    setDraft((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)),
    }));
  function apply() {
    try {
      validatePlan(
        draft,
        "Auto",
        state.abilities.filter((a) => a.enabled).map((a) => a.name),
        state.conversations[work.conversationId]?.turns.flatMap((t) =>
          t.attachments.map((a) => a.digest),
        ) ?? [],
      );
      setError("");
      send({
        type: "revise_plan",
        turnId: work.turnId,
        revision: ps.revision,
        plan: draft,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(ps.plan);
  const label =
    ps.plan.topology === "parallel"
      ? "Working in parallel"
      : ps.plan.topology === "chain"
        ? "Step by step"
        : ps.plan.topology === "fanout"
          ? "Survey and explore"
          : "Connected work";
  return (
    <section
      className="gc-work gc-surface"
      aria-label={editing ? "Editable approach" : label}
    >
      <div className="gc-work-head">
        <span className="gc-work-title">
          {editing
            ? ps.awaitingApproval
              ? "Proposed approach"
              : "Revise the approach"
            : label}
        </span>
        <span className="gc-work-caption">Revision {ps.revision}</span>
        <div className="gc-inline-actions">
          {!editing && live && (
            <button
              className="gc-small"
              disabled={locked}
              onClick={() => {
                setDraft(ps.plan);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          <button
            className="gc-small"
            aria-expanded={dependencies}
            onClick={() => setDependencies((v) => !v)}
          >
            Dependencies
          </button>
          <button
            className="gc-small"
            aria-expanded={activity}
            onClick={() => setActivity((v) => !v)}
          >
            Activity
          </button>
          <button
            className="gc-icon"
            aria-label={collapsed ? "Expand work" : "Collapse work"}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? "⌄" : "⌃"}
          </button>
        </div>
      </div>
      {ps.problem && (
        <p className="gc-plan-description" role="status">
          {ps.problem}
        </p>
      )}
      {!collapsed && (
        <>
          {editing ? (
            <>
              <div className="gc-plan-description">
                {ps.plan.reason}{" "}
                {ps.awaitingApproval
                  ? "Adjust the steps, then start when you’re ready."
                  : "Accepted findings stay available when their premises are unchanged."}
              </div>
              <div className="gc-plan-list">
                {draft.tasks.map((task, i) => (
                  <div className="gc-plan-row" key={task.id}>
                    <span className="gc-plan-number">{i + 1}</span>
                    <div className="gc-plan-content">
                      <input
                        aria-label={`Step ${i + 1} title`}
                        value={task.title}
                        onChange={(e) =>
                          patch(task.id, { title: e.target.value })
                        }
                      />
                      <textarea
                        rows={2}
                        aria-label={`Step ${i + 1} instruction`}
                        value={task.instruction}
                        onChange={(e) =>
                          patch(task.id, { instruction: e.target.value })
                        }
                      />
                      <select
                        aria-label={`Step ${i + 1} ability`}
                        value={task.ability}
                        onChange={(e) =>
                          patch(task.id, { ability: e.target.value })
                        }
                      >
                        <option value="">Available context</option>
                        {state.abilities
                          .filter((a) => a.enabled)
                          .map((a) => (
                            <option key={a.name} value={a.name}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                      {dependencies && (
                        <fieldset>
                          <legend>After</legend>
                          {draft.tasks
                            .filter((t) => t.id !== task.id)
                            .map((t) => (
                              <label key={t.id}>
                                <input
                                  type="checkbox"
                                  checked={task.dependsOn.includes(t.id)}
                                  onChange={(e) =>
                                    patch(task.id, {
                                      dependsOn: e.target.checked
                                        ? [...task.dependsOn, t.id]
                                        : task.dependsOn.filter(
                                            (id) => id !== t.id,
                                          ),
                                    })
                                  }
                                />
                                {t.title}
                              </label>
                            ))}
                        </fieldset>
                      )}
                      {!dependencies && (
                        <span className="gc-dep">
                          {task.dependsOn.length
                            ? "After: " +
                              task.dependsOn
                                .map(
                                  (id) =>
                                    draft.tasks.find((t) => t.id === id)
                                      ?.title ?? "Removed step",
                                )
                                .join(", ")
                            : "No prerequisite"}
                        </span>
                      )}
                    </div>
                    <button
                      className="gc-icon"
                      aria-label={`Move step ${i + 1} earlier`}
                      disabled={!i}
                      onClick={() =>
                        setDraft((d) => {
                          const tasks = [...d.tasks];
                          [tasks[i - 1], tasks[i]] = [tasks[i], tasks[i - 1]];
                          return { ...d, tasks };
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      className="gc-icon"
                      aria-label={`Remove step ${i + 1}`}
                      disabled={draft.tasks.length === 1}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          tasks: d.tasks.filter((t) => t.id !== task.id),
                        }))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="gc-edit-note">
                <button
                  className="gc-small"
                  disabled={draft.tasks.length >= 8}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      tasks: [
                        ...d.tasks,
                        {
                          id: "step_" + crypto.randomUUID().slice(0, 8),
                          title: "New step",
                          instruction: "",
                          ability: "",
                          dependsOn: [],
                        },
                      ],
                    }))
                  }
                >
                  + Add step
                </button>
              </div>
              {error && (
                <p className="gc-plan-description" role="alert">
                  {error}
                </p>
              )}
              <div className="gc-work-foot">
                <span>
                  {dirty
                    ? "Changes are not applied yet."
                    : ps.awaitingApproval
                      ? "Waiting for you"
                      : "Current approach"}
                </span>
                <span className="gc-spacer" />
                {!ps.awaitingApproval && (
                  <button
                    className="gc-small"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="gc-primary"
                  disabled={locked || !live}
                  onClick={() =>
                    dirty
                      ? apply()
                      : ps.awaitingApproval
                        ? send({
                            type: "approve_plan",
                            turnId: work.turnId,
                            revision: ps.revision,
                          })
                        : setEditing(false)
                  }
                >
                  {dirty
                    ? "Apply changes"
                    : ps.awaitingApproval
                      ? "Start"
                      : "Done"}
                </button>
              </div>
            </>
          ) : (
            <>
              {dependencies && (
                <div
                  className="gc-dependency-overview"
                  aria-label="Dependencies"
                >
                  {ps.plan.tasks.map((t) => (
                    <p key={t.id}>
                      <strong>{t.title}</strong>
                      <span>
                        {t.dependsOn.length
                          ? " ← " +
                            t.dependsOn
                              .map(
                                (id) =>
                                  ps.plan.tasks.find((x) => x.id === id)?.title,
                              )
                              .join(" + ")
                          : " · independent"}
                      </span>
                    </p>
                  ))}
                </div>
              )}
              <div
                className={
                  ps.plan.topology === "chain" ? "gc-step-trail" : "gc-tabs"
                }
                role="tablist"
                aria-label="Work streams"
              >
                {ps.plan.tasks.map((t, i) => (
                  <button
                    className="gc-tab"
                    id={"task-" + t.id}
                    key={t.id}
                    role="tab"
                    tabIndex={t.id === active.id ? 0 : -1}
                    aria-selected={t.id === active.id}
                    aria-controls="work-panel"
                    onClick={() => setSelected(t.id)}
                    onKeyDown={(e) => {
                      const offset =
                        e.key === "ArrowRight"
                          ? 1
                          : e.key === "ArrowLeft"
                            ? -1
                            : 0;
                      if (offset) {
                        e.preventDefault();
                        const t =
                          ps.plan.tasks[
                            (i + offset + ps.plan.tasks.length) %
                              ps.plan.tasks.length
                          ];
                        setSelected(t.id);
                        document.getElementById("task-" + t.id)?.focus();
                      }
                    }}
                  >
                    <span
                      className={
                        "gc-dot " +
                        (status(t.id) === "Complete"
                          ? "complete"
                          : ["Working", "Thinking", "Using a source"].includes(
                                status(t.id),
                              )
                            ? "working"
                            : "waiting")
                      }
                    />
                    {t.title}
                    <span className="sr-only"> · {status(t.id)}</span>
                  </button>
                ))}
              </div>
              <div
                className="gc-body"
                id="work-panel"
                role="tabpanel"
                aria-labelledby={"task-" + active.id}
              >
                <div className="gc-status">{status(active.id)}</div>
                <h3>{active.title}</h3>
                <StreamingProse markdown={agentText(runtime(active.id))} />
                <div className="gc-task-footer">
                  <span className="gc-work-caption">
                    {active.ability || "Conversation context"}
                  </span>
                  {live &&
                    runtime(active.id) &&
                    !["done", "failed"].includes(runtime(active.id)!.phase) && (
                      <button
                        className="gc-small"
                        onClick={() =>
                          send({
                            type: "cancel_agent",
                            agentId: runtime(active.id)!.id,
                          })
                        }
                      >
                        Stop this part
                      </button>
                    )}
                </div>
              </div>
              <div className="gc-work-foot">
                <span>
                  {
                    new Set([
                      ...ps.retained,
                      ...Object.keys(work.outcomes).filter(
                        (id) => work.outcomes[id].accepted,
                      ),
                    ]).size
                  }{" "}
                  accepted · {ps.plan.tasks.length} requested
                </span>
                <span className="gc-spacer" />
                <span>
                  {work.paused
                    ? "Paused"
                    : work.phase === "answering"
                      ? "Bringing findings together"
                      : live
                        ? "In progress"
                        : "Ended"}
                </span>
              </div>
            </>
          )}
          {activity && (
            <div className="glass-activity">
              <p>{work.decision}</p>
              {work.coverage && (
                <details>
                  <summary>Source coverage</summary>
                  <Prose markdown={work.coverage} />
                </details>
              )}
              {[...work.roster.agents.values()].map((a) => (
                <details key={a.id}>
                  <summary>
                    {ps.plan.tasks.find((t) => t.id === work.keys[a.id])
                      ?.title ??
                      (work.keys[a.id] === "answer"
                        ? "Combined answer"
                        : "Decision")}{" "}
                    · {a.phase} · {a.toolCallCount} tool calls
                  </summary>
                  {a.timeline?.map((item) => (
                    <div key={item.id}>
                      {item.kind === "tool_call" ? (
                        <p>
                          {item.tool} · {item.argsSummary}
                        </p>
                      ) : item.kind === "tool_result" ? (
                        <p>
                          {item.preview ?? `${item.byteLength} bytes returned`}
                        </p>
                      ) : item.kind === "think" ? (
                        <details>
                          <summary>Model reasoning</summary>
                          <Prose markdown={item.body} />
                        </details>
                      ) : (
                        <Prose markdown={agentText(a)} />
                      )}
                    </div>
                  ))}
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
