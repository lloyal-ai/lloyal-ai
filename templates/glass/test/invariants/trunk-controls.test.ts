import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { proseText } from "../../src/domain/prose.js";
import { Conversations } from "../../src/harness/storage.js";
import {
  Conversation,
  inferenceRoots,
  inferenceTurns,
} from "../../src/domain/conversation.js";
import type { WorkflowEvent } from "../../src/protocol.js";
import { runHarness } from "./harness.js";
const make = () =>
  Conversation.parse({
    version: 1,
    id: randomUUID(),
    revision: 0,
    title: "Trip",
    updatedAt: new Date().toISOString(),
    turns: [
      {
        id: randomUUID(),
        question: "Packing list",
        submittedAt: new Date().toISOString(),
        status: "complete",
        answer: "Take a coat",
        payload: {
          kind: "checklist",
          result: "For the trip",
          sources: [],
          checklist: [{ text: "Coat", detail: "For rain" }],
        },
      },
      {
        id: randomUUID(),
        question: "Check the forecast",
        submittedAt: new Date().toISOString(),
        status: "interrupted",
        answer: null,
        mode: "Direct",
      },
    ],
  });
const ended = (e: WorkflowEvent) => e.type === "work:ended";
test("checklist edits persist, stale edits fail, and discarding one turn leaves the other intact", async () => {
  const base = make();
  let saved: Conversation;
  const r = await runHarness({
    setup: (root) => {
      new Conversations(root).save(base, 0);
    },
    observe: (e) => {
      if (e.type === "conversation") saved = e.record;
    },
    script: [
      { send: { type: "open_conversation", id: base.id } },
      {
        on: (e) => e.type === "conversation:active",
        send: () => ({
          type: "check_item",
          id: base.id,
          turnId: base.turns[0].id,
          revision: saved.revision,
          index: 0,
          checked: true,
        }),
      },
      {
        on: (e) => e.type === "conversation" && e.record.revision === 2,
        send: {
          type: "check_item",
          id: base.id,
          turnId: base.turns[0].id,
          revision: 1,
          index: 0,
          checked: false,
        },
      },
      {
        on: (e) => e.type === "ui:error",
        send: () => ({
          type: "discard_turn",
          id: base.id,
          turnId: base.turns[1].id,
          revision: saved.revision,
        }),
      },
      { on: (e) => e.type === "conversation" && e.record.turns.length === 1 },
    ],
  });
  const disk = new Conversations(r.outputDir).read(base.id);
  assert.deepEqual(disk.turns[0].checked, [0]);
  assert.equal(disk.turns[0].id, base.turns[0].id);
  assert.equal(disk.turns.length, 1);
  assert.equal(
    r.events.some((e) => e.type === "agent:spawn"),
    false,
  );
});
test("Continue creates a new turn after an interrupted request without relabelling it complete", async () => {
  const base = make();
  let saved: Conversation;
  const r = await runHarness({
    setup: (root) => {
      new Conversations(root).save(base, 0);
    },
    utterances: [
      { kind: "report", text: "I need a location to check the forecast." },
    ],
    observe: (e) => {
      if (e.type === "conversation") saved = e.record;
    },
    script: [
      { send: { type: "open_conversation", id: base.id } },
      {
        on: (e) => e.type === "conversation:active",
        send: () => ({
          type: "continue_conversation",
          id: base.id,
          turnId: base.turns[1].id,
          revision: saved.revision,
        }),
      },
      { on: ended },
    ],
  });
  assert.equal(r.failure, undefined);
  assert.equal(saved!.turns.length, 3);
  assert.equal(saved!.turns[1].status, "interrupted");
  assert.equal(saved!.turns[2].status, "complete");
  assert.equal(saved!.turns[2].question, "Check the forecast");
  assert.equal(saved!.turns[2].continuationOf, base.turns[1].id);
});
test("a restricted inference boundary retains older selected upload descriptors across reopen", () => {
  const record = make(),
    keep = { digest: "keep", mediaType: "application/pdf", size: 10 },
    drop = { digest: "drop", mediaType: "application/pdf", size: 20 };
  record.turns[0].attachments = [keep, drop];
  record.turns[1].sourceScope = {
    inputs: [keep.digest],
    excluded: ["web"],
    roots: [keep],
  };
  const restored = inferenceTurns(
    Conversation.parse(JSON.parse(JSON.stringify(record))),
  );
  assert.equal(restored.length, 1);
  assert.deepEqual(restored.flatMap(inferenceRoots), [keep]);
  assert.equal(record.turns.length, 2);
});
test("an explicit answer preference is retained with the durable request", async () => {
  const r = await runHarness({
    utterances: [{ kind: "report", text: "Brief answer" }],
    script: [
      {
        send: {
          type: "submit_query",
          mode: "Direct",
          query: "Explain",
          preferences: { detail: "brief", work: "compact", motion: "reduced" },
        },
      },
      { on: ended },
    ],
  });
  const record = r.events.findLast(
    (e): e is Extract<WorkflowEvent, { type: "conversation" }> =>
      e.type === "conversation",
  )!.record;
  assert.equal(record.turns[0].preferences?.detail, "brief");
  assert.equal(record.turns[0].question, "Explain");
});

test("a sentence spanning emphasis and a citation has a stable plain-text reference", () => {
  const md =
    "The **blue light** scatters [more](https://example.com).\n\nThe blue light scatters more.";
  assert.equal(
    proseText(md),
    "The blue light scatters more.The blue light scatters more.",
  );
});
test("a formatted prose selection is validated and retained as a reference", async () => {
  const base = make();
  base.turns[0].answer =
    "The **blue light** scatters [more](https://example.com).";
  delete base.turns[0].payload;
  let saved: Conversation;
  const text = "blue light scatters more",
    start = 4;
  const r = await runHarness({
    setup: (root) => {
      new Conversations(root).save(base, 0);
    },
    utterances: [
      { kind: "report", text: "Shorter wavelengths scatter more strongly." },
    ],
    observe: (e) => {
      if (e.type === "conversation") saved = e.record;
    },
    script: [
      {
        send: {
          type: "submit_query",
          query: "Why?",
          conversationId: base.id,
          revision: 1,
          mode: "Direct",
          selection: {
            turnId: base.turns[0].id,
            answerRevision: 1,
            unit: "prose-text",
            text,
            start,
            end: start + text.length,
          },
        },
      },
      { on: ended },
    ],
  });
  assert.equal(r.failure, undefined);
  assert.equal(saved!.turns.at(-1)?.selection?.text, text);
  assert.equal(saved!.turns.at(-1)?.status, "complete");
});
