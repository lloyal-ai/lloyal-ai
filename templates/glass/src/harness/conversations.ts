import { randomUUID } from "node:crypto";
import { ensure, useScope } from "effection";
import type { Channel, Operation } from "effection";
import type { EventBus } from "@lloyal-labs/binding";
import type { Session } from "@lloyal-labs/sdk";
import { waitUntilSettled } from "@lloyal-labs/lloyal-agents";
import type { Descriptor } from "@lloyal-labs/media";
import { admitted, OperationFailure } from "@lloyal-labs/rig";
import type { Execution, Handlers } from "@lloyal-labs/rig";
import { Conversations } from "./storage.js";
import {
  inferenceTurns as scopedTurns,
  inferenceRoots as turnRefs,
} from "../domain/conversation.js";
import { compose, WorkControl } from "./work.js";
import { answerText, Selection } from "../domain/answer.js";
import { proseText } from "../domain/prose.js";
import { Preferences } from "../domain/preferences.js";
import { Mode } from "../domain/work.js";
import { render } from "./prompts.js";
import { errorMessage } from "../protocol.js";
import type {
  Command,
  WorkflowEvent,
  Conversation,
  Turn,
} from "../protocol.js";
import { initialState, reduce } from "../ui/state.js";
import { streamedAnswer } from "../ui/select.js";

export function* conversations(deps: {
  session: Session;
  run: Execution;
  wire: Channel<WorkflowEvent, void>;
  events: EventBus<WorkflowEvent>;
  root: string;
}): Operation<{
  handlers: Handlers<Command>;
  submit(
    query: string,
    id?: string | null,
    revision?: number,
    attachments?: Descriptor[],
    excluded?: string[],
    mode?: Mode,
    selection?: Selection,
    preferences?: Preferences,
  ): Operation<Operation<void>>;
}> {
  const { session, run, wire } = deps;
  const owner = yield* useScope();
  const repository = new Conversations(deps.root);
  let snapshot = initialState;
  const unsubscribe = deps.events.subscribe((event) => {
    snapshot = reduce(snapshot, event);
  });
  yield* ensure(unsubscribe);
  let remembered: { id: string; revision: number } | null = null;
  let active: {
    record: Conversation;
    turnId: string;
    cancelled: boolean;
    control: WorkControl;
  } | null = null;

  function* shelf(): Operation<void> {
    const { entries, errors } = repository.list();
    yield* wire.send({ type: "conversations", entries });
    for (const message of errors)
      yield* wire.send({ type: "ui:error", message });
  }
  function* show(record: Conversation): Operation<void> {
    yield* wire.send({ type: "conversation", record });
    yield* shelf();
  }
  const baseQuery = (turn: Turn) =>
    render("directed", {
      question: render("preferred", {
        question: turn.selection
          ? render("selected", {
              query: turn.question,
              selection: turn.selection,
            })
          : turn.question,
        preferences: turn.preferences,
      }),
      directions: turn.directions,
    });
  const turnQuery = (turn: Turn) =>
    turn.continuationOf
      ? render("continue", { question: baseQuery(turn) })
      : baseQuery(turn);
  function* restore(record: Conversation): Operation<void> {
    if (remembered?.id === record.id && remembered.revision === record.revision)
      return;
    remembered = null;
    yield* waitUntilSettled(session.dispose());
    for (const turn of scopedTurns(record)) {
      const refs = [
        ...turnRefs(turn),
        ...turn.viewed.filter(
          (r) => !turn.attachments.some((a) => a.digest === r.digest),
        ),
      ];
      const seen = yield* admitted(refs);
      if ("refused" in seen)
        throw new Error("Cannot reopen the saved evidence: " + seen.refused);
      if (seen.bitmaps.length) {
        yield* waitUntilSettled(
          session.prefillUserMultimodal(turnQuery(turn), seen.bitmaps, {
            attachments: seen.projected,
          }),
        );
        yield* waitUntilSettled(
          session.prefillAssistant(turn.answer ?? render("interrupted")),
        );
      } else
        yield* waitUntilSettled(
          session.commitTurn(
            turnQuery(turn),
            turn.answer ?? render("interrupted"),
          ),
        );
    }
    remembered = { id: record.id, revision: record.revision };
  }
  function* submit(
    query: string,
    id?: string | null,
    revision?: number,
    attachments: Descriptor[] = [],
    excluded: string[] = [],
    mode: Mode = "Auto",
    selection?: Selection,
    preferences?: Preferences,
    continuation?: Turn,
  ): Operation<Operation<void>> {
    if (!query.trim()) throw new Error("Write a message first.");
    if (run.busy || active)
      throw new Error(
        "Wait for this work to finish, or stop it before sending another message.",
      );
    Mode.parse(mode);
    const seen = yield* admitted(attachments);
    if ("refused" in seen) throw new Error(seen.refused);
    const previous = id ? repository.read(id) : repository.create();
    if (id && previous.revision !== revision)
      throw new Error(
        "This conversation changed. Reopen it before sending again.",
      );
    if (selection) {
      Selection.parse(selection);
      const t = previous.turns.find((t) => t.id === selection.turnId);
      let value: string | undefined;
      if (t?.answer) {
        if (
          selection.unit === "prose" &&
          selection.start !== undefined &&
          selection.end !== undefined
        )
          value = t.answer.slice(selection.start, selection.end);
        else if (
          selection.unit === "prose-text" &&
          selection.start !== undefined &&
          selection.end !== undefined
        )
          value = proseText(t.payload?.result ?? t.answer).slice(
            selection.start,
            selection.end,
          );
        else if (selection.unit.startsWith("cell:")) {
          const [, row, col] = selection.unit.split(":");
          value = t.payload?.table?.rows[Number(row)]?.[Number(col)];
        } else if (selection.unit.startsWith("step:"))
          value = t.plan?.tasks.find(
            (x) => x.id === selection.unit.slice(5),
          )?.instruction;
        else if (selection.unit.startsWith("check:"))
          value = t.payload?.checklist?.[Number(selection.unit.slice(6))]?.text;
      }
      if (value !== selection.text)
        throw new Error(
          "That selection no longer matches an accepted answer. Select it again.",
        );
    }
    if (preferences) Preferences.parse(preferences);
    const modelQuery = continuation
      ? render("continue", { question: baseQuery(continuation) })
      : render("preferred", {
          question: selection
            ? render("selected", { query: query.trim(), selection })
            : query.trim(),
          preferences,
        });
    const release = repository.claim(previous.id);
    const turnId = randomUUID();
    let record: Conversation;
    try {
      record = repository.save(
        {
          ...previous,
          title: previous.turns.length
            ? previous.title
            : query.trim().slice(0, 100),
          turns: [
            ...previous.turns,
            {
              id: turnId,
              question: query.trim(),
              directions: continuation?.directions ?? [],
              ...(continuation ? { continuationOf: continuation.id } : {}),
              submittedAt: new Date().toISOString(),
              status: "pending",
              answer: null,
              attachments: seen.roots,
              viewed: [],
              excluded,
              mode,
              ...(preferences ? { preferences } : {}),
              ...(selection ? { selection } : {}),
            },
          ],
        },
        previous.revision,
      );
    } catch (error) {
      release();
      throw error;
    }
    const turn = {
      record,
      turnId,
      cancelled: false,
      control: new WorkControl(mode),
    };
    active = turn;
    yield* show(record);
    yield* wire.send({ type: "conversation:active", id: record.id });
    yield* wire.send({ type: "work:start", conversationId: record.id, turnId });
    const accepted = yield* run.replace(turnId, function* () {
      try {
        yield* restore(previous);
        yield* wire.send({ type: "work:phase", phase: "working" });
        if (seen.bitmaps.length) {
          yield* waitUntilSettled(
            session.prefillUserMultimodal(modelQuery, seen.bitmaps, {
              attachments: seen.projected,
            }),
          );
          yield* wire.send({ type: "media:admitted", roots: seen.projected });
        }
        const roots = [
          ...new Map(
            [...scopedTurns(previous).flatMap(turnRefs), ...seen.roots].map(
              (r) => [r.digest, r],
            ),
          ).values(),
        ];
        const available = yield* admitted(roots);
        if ("refused" in available) throw new Error(available.refused);
        turn.control.resetScope = function* (query, roots) {
          remembered = null;
          yield* waitUntilSettled(session.dispose());
          const selected = yield* admitted(roots);
          if ("refused" in selected) throw new Error(selected.refused);
          if (selected.bitmaps.length) {
            yield* waitUntilSettled(
              session.prefillUserMultimodal(query, selected.bitmaps, {
                attachments: selected.projected,
              }),
            );
            yield* wire.send({
              type: "media:admitted",
              roots: selected.projected,
            });
          }
          return session.trunk;
        };
        turn.control.checkpoint = function* () {
          const current = turn.record.turns.find((t) => t.id === turnId)!;
          const updated = {
            ...current,
            excluded: turn.control.finalExcluded,
            ...(turn.control.plan ? { plan: turn.control.plan } : {}),
            ...(turn.control.sourceRestricted
              ? {
                  sourceScope: {
                    inputs: turn.control.finalInputs,
                    excluded: turn.control.finalExcluded,
                    roots: available.roots.filter((a) =>
                      turn.control.finalInputs.includes(a.digest),
                    ),
                  },
                }
              : {}),
          };
          if (JSON.stringify(updated) !== JSON.stringify(current)) {
            turn.record = repository.save(
              {
                ...turn.record,
                turns: turn.record.turns.map((t) =>
                  t.id === turnId ? updated : t,
                ),
              },
              turn.record.revision,
            );
            yield* show(turn.record);
          }
        };
        const recent = scopedTurns(previous)
          .slice()
          .reverse()
          .find((t) => t.answer !== null);
        const payload = yield* compose(
          session.trunk,
          modelQuery,
          available.roots,
          excluded,
          turn.control,
          session.userSidePending,
          recent
            ? render("conversation-boundary", {
                question: turnQuery(recent).slice(0, 2000),
                answer: recent.answer!.slice(0, 4000),
              })
            : "",
        );
        const text = answerText(payload);
        turn.record = repository.save(
          {
            ...turn.record,
            turns: turn.record.turns.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status:
                      turn.control.finishing ||
                      (turn.control.plan &&
                        turn.control.plan.tasks.some(
                          (t) => !turn.control.findings.has(t.id),
                        ))
                        ? "partial"
                        : "complete",
                    answer: text,
                    payload,
                    excluded: turn.control.finalExcluded,
                    ...(turn.control.sourceRestricted
                      ? {
                          sourceScope: {
                            inputs: turn.control.finalInputs,
                            excluded: turn.control.finalExcluded,
                            roots: available.roots.filter((a) =>
                              turn.control.finalInputs.includes(a.digest),
                            ),
                          },
                        }
                      : {}),
                    ...(turn.control.plan ? { plan: turn.control.plan } : {}),
                    viewed: snapshot.work?.viewed ?? [],
                  }
                : t,
            ),
          },
          turn.record.revision,
        );
        remembered = null;
        yield* show(turn.record);
        // A new source boundary must not leave withdrawn evidence resident for the next turn.
        // Rebuild only on demand after a restricted answer; the durable conversation remains inspectable.
        if (turn.control.sourceRestricted) {
          yield* waitUntilSettled(session.dispose());
          remembered = null;
          return;
        }
        const finalQuery = turn.control.finalQuery || modelQuery;
        if (
          session.userSidePending &&
          turn.record.turns.at(-1)!.directions.length
        ) {
          // The saved turn includes its directions; rebuild that one canonical
          // exchange rather than adding the original media question twice.
          yield* waitUntilSettled(session.dispose());
          remembered = null;
          return;
        }
        yield* waitUntilSettled(
          session.userSidePending
            ? session.prefillAssistant(text)
            : session.commitTurn(finalQuery, text),
        );
        remembered = { id: record.id, revision: turn.record.revision };
      } catch (error) {
        remembered = null;
        if (turn.cancelled) throw error;
        if (turn.record.turns.at(-1)?.status === "pending") {
          turn.record = repository.save(
            {
              ...turn.record,
              turns: turn.record.turns.map((t) =>
                t.id === turnId
                  ? { ...t, status: "failed", reason: errorMessage(error) }
                  : t,
              ),
            },
            turn.record.revision,
          );
          yield* show(turn.record);
        }
        yield* wire.send({ type: "ui:error", message: errorMessage(error) });
        throw new OperationFailure(error);
      }
    });
    yield* owner.spawn(function* () {
      yield* ensure(function* () {
        release();
        if (turn.record.turns.at(-1)?.status === "pending") {
          turn.record = repository.save(
            {
              ...turn.record,
              turns: turn.record.turns.map((t) =>
                t.id === turnId
                  ? {
                      ...t,
                      status: "interrupted",
                      reason: "Stopped before a complete answer was saved.",
                    }
                  : t,
              ),
            },
            turn.record.revision,
          );
          yield* show(turn.record);
        }
        if (active === turn) active = null;
        yield* wire.send({
          type: "work:ended",
          conversationId: record.id,
          turnId,
          reason: turn.cancelled ? "stopped" : "settled",
        });
      });
      try {
        yield* accepted;
      } catch {
        /* The operation reports its failure. */
      }
    });
    return accepted;
  }
  const current = (turnId: string) => {
    if (!active || active.turnId !== turnId || !run.busy)
      throw new Error("That work is no longer active.");
    return active;
  };
  const handlers: Handlers<Command> = {
    *steer_work({ turnId, revision, query }) {
      const a = current(turnId);
      if (a.record.revision !== revision)
        throw new Error(
          "This conversation changed. Reopen it before steering.",
        );
      if (
        a.control.directionPending ||
        a.control.changing ||
        a.control.finishing
      )
        throw new Error("Wait for the current change to settle.");
      if (!query.trim() || query.length > 12000)
        throw new Error("Write a direction of up to 12,000 characters.");
      a.record = repository.save(
        {
          ...a.record,
          turns: a.record.turns.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  directions: [
                    ...t.directions,
                    {
                      id: randomUUID(),
                      query: query.trim(),
                      submittedAt: new Date().toISOString(),
                    },
                  ],
                }
              : t,
          ),
        },
        revision,
      );
      a.control.requestDirection(query);
      if (snapshot.work?.paused) {
        run.resume();
        yield* wire.send({ type: "work:paused", paused: false });
      }
      yield* show(a.record);
      yield* wire.send({ type: "work:phase", phase: "revising" });
    },
    *approve_plan({ turnId, revision }) {
      const a = current(turnId);
      a.control.approve(revision);
      yield* wire.send({ type: "work:plan", state: a.control.state()! });
    },
    *revise_plan({ turnId, revision, plan }) {
      const a = current(turnId);
      a.control.revise(plan, revision);
      yield* wire.send({ type: "work:phase", phase: "revising" });
    },
    *finish_work({ turnId }) {
      const a = current(turnId);
      if (snapshot.work?.paused) throw new Error("Resume before finishing up.");
      a.control.finish();
      run.wrapUp();
    },
    *search_conversations({ query }) {
      const entries = repository.list().entries.filter((e) => {
        const r = repository.read(e.id);
        return [
          r.title,
          ...r.turns.flatMap((t) => [
            t.question,
            t.answer ?? "",
            ...t.directions.map((d) => d.query),
          ]),
        ].some((t) =>
          t.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        );
      });
      yield* wire.send({ type: "conversations:search", query, entries });
    },
    *submit_query(c) {
      yield* submit(
        c.query,
        c.conversationId,
        c.revision,
        c.attachments,
        c.excluded,
        c.mode,
        c.selection,
        c.preferences,
      );
    },
    *open_conversation({ id }) {
      if (id) yield* show(repository.read(id));
      yield* wire.send({ type: "conversation:active", id });
    },
    *list_conversations() {
      yield* shelf();
    },
    *continue_conversation({ id, turnId, revision }) {
      const record = repository.read(id),
        turn = record.turns.find((t) => t.id === turnId);
      if (record.revision !== revision)
        throw new Error(
          "This conversation changed. Reopen it before continuing.",
        );
      if (!turn || turn.status === "pending" || turn.status === "complete")
        throw new Error("That turn does not need continuation.");
      yield* submit(
        turn.question,
        id,
        revision,
        turnRefs(turn),
        turn.excluded,
        turn.mode ?? "Auto",
        turn.selection,
        turn.preferences,
        turn,
      );
    },
    *discard_turn({ id, turnId, revision }) {
      if (repository.isLive(id))
        throw new Error("Stop this conversation before discarding a turn.");
      const record = repository.read(id);
      if (!record.turns.some((t) => t.id === turnId))
        throw new Error("That turn is no longer available.");
      const kept = repository.save(
        { ...record, turns: record.turns.filter((t) => t.id !== turnId) },
        revision,
      );
      if (remembered?.id === id) remembered = null;
      yield* show(kept);
    },
    *check_item({ id, turnId, revision, index, checked }) {
      if (repository.isLive(id))
        throw new Error(
          "Wait for this conversation to finish before updating its checklist.",
        );
      const record = repository.read(id),
        turn = record.turns.find((t) => t.id === turnId);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        !turn?.payload?.checklist?.[index]
      )
        throw new Error("That checklist item is no longer available.");
      const values = new Set(turn.checked ?? []);
      if (checked) values.add(index);
      else values.delete(index);
      const kept = repository.save(
        {
          ...record,
          turns: record.turns.map((t) =>
            t.id === turnId
              ? { ...t, checked: [...values].sort((a, b) => a - b) }
              : t,
          ),
        },
        revision,
      );
      // UI check state is not model evidence; leave inference content unchanged.
      if (remembered?.id === id && remembered.revision === revision)
        remembered = { id, revision: kept.revision };
      yield* show(kept);
    },
    *discard_conversation({ id, revision }) {
      repository.remove(id, revision);
      if (remembered?.id === id) remembered = null;
      yield* wire.send({ type: "conversation:removed", id });
      yield* shelf();
    },
    *keep_partial({ id, turnId, revision }) {
      if (run.busy) throw new Error("Wait until stopping has finished.");
      if (
        snapshot.work?.conversationId !== id ||
        snapshot.work.turnId !== turnId
      )
        throw new Error("That draft is no longer available.");
      const text = streamedAnswer(snapshot);
      if (!text.trim()) throw new Error("There is no answer text to keep.");
      const record = repository.read(id);
      if (record.revision !== revision)
        throw new Error("The conversation changed. Reopen it first.");
      const target = record.turns.find((t) => t.id === turnId);
      if (!target || target.answer !== null)
        throw new Error("That turn already has a saved answer.");
      const kept = repository.save(
        {
          ...record,
          turns: record.turns.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  answer: text,
                  viewed: snapshot.work?.viewed ?? [],
                  status: "partial",
                }
              : t,
          ),
        },
        revision,
      );
      remembered = null;
      yield* show(kept);
    },
    *stop() {
      if (!active) return;
      active.cancelled = true;
      remembered = null;
      yield* wire.send({ type: "work:phase", phase: "stopping" });
      yield* run.stop();
    },
    *pause() {
      if (run.busy) {
        run.pause();
        yield* wire.send({ type: "work:paused", paused: true });
      }
    },
    *resume() {
      run.resume();
      yield* wire.send({ type: "work:paused", paused: false });
    },
    *wrap_up() {
      if (snapshot.work?.paused) throw new Error("Resume before finishing up.");
      run.wrapUp();
    },
    *cancel_agent({ agentId }) {
      run.cancel(agentId);
    },
  };
  yield* shelf();
  return { handlers, submit };
}
