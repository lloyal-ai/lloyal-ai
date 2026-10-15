/** Run `create`, restart the isolated host, then `reopen` to prove portable trunk restoration. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connectWss } from "@lloyal-labs/binding/web";
import type {
  Command,
  WorkflowEvent,
  Conversation,
} from "../../src/protocol.js";
const url = process.env.GLASS_WS ?? "ws://127.0.0.1:8789",
  dir = process.env.GLASS_RECEIPTS ?? "verification/smollm2";
const action = process.argv[2] ?? "create",
  events: WorkflowEvent[] = [];
const previous: Conversation | undefined =
  action === "reopen"
    ? JSON.parse(readFileSync(dir + "/trunk-created.json", "utf8")).record
    : undefined;
let record: Conversation | undefined,
  phase = 0,
  finish!: () => void;
const done = new Promise<void>((r) => (finish = r)),
  excluded = ["web", "documents", "wikipedia", "corpus"];
const client = connectWss<WorkflowEvent, Command>(url, {
  onReady() {
    client.send(
      previous
        ? { type: "open_conversation", id: previous.id }
        : {
            type: "submit_query",
            query:
              "Remember that the test codeword is MARIGOLD. Reply with that word only.",
            mode: "Direct",
            excluded,
          },
    );
  },
  onEvent(e) {
    events.push(e);
    if (e.type === "conversation") record = e.record;
    if (previous && e.type === "conversation:active" && phase === 0) {
      phase = 1;
      client.send({ type: "open_conversation", id: previous.id });
    } else if (previous && e.type === "conversation:active" && phase === 1) {
      phase = 2;
      client.send({
        type: "submit_query",
        conversationId: previous.id,
        revision: record!.revision,
        query: "What was the test codeword? Answer with that word only.",
        mode: "Direct",
        excluded,
      });
    }
    if (e.type === "work:ended") finish();
  },
  onClose() {
    finish();
  },
});
const timeout = setTimeout(finish, 120_000);
await done;
clearTimeout(timeout);
client.close();
mkdirSync(dir, { recursive: true });
writeFileSync(
  dir + (previous ? "/trunk-reopened.json" : "/trunk-created.json"),
  JSON.stringify({ record, events }, null, 2),
);
assert.equal(record?.turns.length, previous ? 2 : 1);
assert.equal(record.turns.at(-1)!.status, "complete");
assert.match(record.turns.at(-1)!.answer ?? "", /MARIGOLD/i);
console.log(
  JSON.stringify({
    action,
    id: record.id,
    turns: record.turns.map((t) => ({ status: t.status, answer: t.answer })),
    repeatedReopen: !!previous,
  }),
);
