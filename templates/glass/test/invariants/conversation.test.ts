import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Conversations } from "../../src/harness/storage.js";
import { runHarness } from "./harness.js";
import type { Conversation, WorkflowEvent } from "../../src/protocol.js";
const records = (events: WorkflowEvent[]) =>
  events
    .filter(
      (e): e is Extract<WorkflowEvent, { type: "conversation" }> =>
        e.type === "conversation",
    )
    .map((e) => e.record);
const ended = (e: WorkflowEvent) => e.type === "work:ended";

test("a saved request and accepted answer survive with tracing disabled", async () => {
  const r = await runHarness({
    utterances: [{ kind: "report", text: "The answer is 42." }],
    script: [
      {
        send: {
          type: "submit_query",
          mode: "Direct",
          query: "What is the answer?",
        },
      },
      { on: ended },
    ],
  });
  assert.equal(r.failure, undefined);
  const record = records(r.events).at(-1)!;
  assert.equal(record.turns[0].answer, "The answer is 42.");
  assert.equal(record.turns[0].status, "complete");
  const disk = JSON.parse(
    readFileSync(join(r.outputDir, record.id + ".json"), "utf8"),
  );
  assert.deepEqual(disk, record);
  assert.ok(
    r.events.findIndex((e) => e.type === "conversation") <
      r.events.findIndex((e) => e.type === "agent:spawn"),
  );
});
test("stop immediately preserves the submitted request and releases its claim", async () => {
  const r = await runHarness({
    utterances: [{ kind: "report", text: "Unfinished", stallTokens: 500 }],
    script: [
      { send: { type: "submit_query", mode: "Direct", query: "Start work" } },
      { on: (e) => e.type === "work:start", send: { type: "stop" } },
      { on: ended },
    ],
  });
  const record = records(r.events).at(-1)!;
  assert.equal(record.turns[0].status, "interrupted");
  assert.equal(new Conversations(r.outputDir).isLive(record.id), false);
  assert.equal(r.events.filter(ended).length, 1);
});
test("browsing another conversation leaves live work owned by the original", async () => {
  const other = randomUUID();
  let opened = false;
  const r = await runHarness({
    setup: (root) => {
      new Conversations(root).save(
        {
          version: 1,
          id: other,
          revision: 0,
          title: "Earlier",
          updatedAt: new Date().toISOString(),
          turns: [],
        },
        0,
      );
    },
    utterances: [
      { kind: "report", text: "Completed in the original", stallTokens: 50 },
    ],
    script: [
      { send: { type: "submit_query", mode: "Direct", query: "Current" } },
      {
        on: (e) => e.type === "agent:spawn",
        send: { type: "open_conversation", id: other },
      },
      {
        on: (e) => {
          if (e.type === "conversation:active" && e.id === other) opened = true;
          return opened && ended(e);
        },
      },
    ],
  });
  assert.ok(opened);
  const original = records(r.events).findLast((r) => r.title === "Current")!;
  assert.equal(original.turns[0].answer, "Completed in the original");
  assert.equal(
    r.events.filter((e) => e.type === "conversation:active").at(-1)?.id,
    other,
  );
});
test("reopen twice and follow up does not duplicate durable turns", async () => {
  let saved: Conversation;
  const r = await runHarness({
    utterances: [
      { kind: "report", text: "First answer" },
      { kind: "report", text: "Second answer" },
    ],
    observe: (e) => {
      if (e.type === "conversation") saved = e.record;
    },
    script: [
      { send: { type: "submit_query", mode: "Direct", query: "First" } },
      { on: ended, send: () => ({ type: "open_conversation", id: saved.id }) },
      {
        on: (e) => e.type === "conversation:active",
        send: () => ({ type: "open_conversation", id: saved.id }),
      },
      {
        on: (e) => e.type === "conversation:active",
        send: () => ({
          type: "submit_query",
          mode: "Direct",
          query: "Second",
          conversationId: saved.id,
          revision: saved.revision,
        }),
      },
      { on: (e) => ended(e) && saved.turns.length === 2 },
    ],
  });
  assert.deepEqual(
    records(r.events)
      .at(-1)!
      .turns.map((t) => [t.question, t.answer]),
    [
      ["First", "First answer"],
      ["Second", "Second answer"],
    ],
  );
});
test("restart exposes a pending request as interrupted without executing it", async () => {
  const id = randomUUID();
  const r = await runHarness({
    setup: (root) => {
      new Conversations(root).save(
        {
          version: 1,
          id,
          revision: 0,
          title: "Interrupted",
          updatedAt: new Date().toISOString(),
          turns: [
            {
              id: randomUUID(),
              question: "Saved before crash",
              answer: null,
              status: "pending",
              submittedAt: new Date().toISOString(),
              attachments: [],
              viewed: [],
              excluded: [],
            },
          ],
        },
        0,
      );
    },
    script: [
      { send: { type: "open_conversation", id } },
      { on: (e) => e.type === "conversation:active" },
    ],
  });
  assert.equal(records(r.events).at(-1)!.turns[0].status, "interrupted");
  assert.equal(r.events.filter((e) => e.type === "agent:spawn").length, 0);
});
test("stale writes and discard cannot overwrite another conversation", () => {
  const root = mkdtempSync(join(tmpdir(), "glass-store-")),
    repo = new Conversations(root);
  const a = repo.save(repo.create(), 0),
    b = repo.save(repo.create(), 0);
  assert.throws(() => repo.save({ ...a, title: "stale" }, 0), /changed/);
  const release = repo.claim(a.id);
  assert.throws(() => repo.remove(a.id, a.revision), /Stop/);
  release();
  repo.remove(a.id, a.revision);
  assert.equal(repo.read(b.id).id, b.id);
  assert.throws(() => repo.read("../escape"), /identity/);
});
test("unknown records are surfaced and preserved", () => {
  const root = mkdtempSync(join(tmpdir(), "glass-store-")),
    repo = new Conversations(root),
    id = randomUUID();
  const text = JSON.stringify({ version: 99, id });
  writeFileSync(join(root, id + ".json"), text);
  assert.equal(repo.list().errors.length, 1);
  assert.equal(readFileSync(join(root, id + ".json"), "utf8"), text);
});
