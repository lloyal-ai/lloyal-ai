/** Independent resident contexts and the public host's admission limit. Use MAX_SESSIONS=2 with no other clients. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { connectWss } from "@lloyal-labs/binding/web";
import type {
  Command,
  WorkflowEvent,
  Conversation,
} from "../../src/protocol.js";
const url = process.env.GLASS_WS ?? "ws://127.0.0.1:8789",
  directory = process.env.GLASS_RECEIPTS ?? "verification/sessions";
const excluded = ["web", "documents", "wikipedia", "corpus"];
function connection(word: string) {
  let record: Conversation | undefined,
    ready!: () => void,
    finished!: () => void,
    queued!: () => void,
    live = false;
  const readiness = new Promise<void>((r) => (ready = r)),
    done = new Promise<void>((r) => (finished = r)),
    queue = new Promise<void>((r) => (queued = r)),
    events: unknown[] = [];
  const client = connectWss<WorkflowEvent, Command>(url, {
    onSession(e) {
      events.push({ session: e });
      if (e.phase === "queued") queued();
    },
    onEvent(e) {
      events.push(e);
      if (e.type === "weights:done") {
        live = true;
        ready();
      }
      if (e.type === "conversation") record = e.record;
      if (e.type === "work:ended") finished();
    },
  });
  return {
    client,
    events,
    readiness,
    done,
    queue,
    word,
    get live() {
      return live;
    },
    get record() {
      return record;
    },
    submit() {
      client.send({
        type: "submit_query",
        mode: "Direct",
        query: `For this conversation, remember the codeword ${word}. Reply with only that codeword.`,
        excluded,
      });
    },
  };
}
const clients: ReturnType<typeof connection>[] = [],
  checks: Record<string, boolean> = {};
let failure: string | undefined, timer: ReturnType<typeof setTimeout>;
async function journey() {
  const a = connection("MARIGOLD"),
    b = connection("HARBOR");
  clients.push(a, b);
  await Promise.all([a.readiness, b.readiness]);
  const c = connection("CITRINE");
  clients.push(c);
  await c.queue;
  checks.thirdQueued = !c.live;
  a.submit();
  b.submit();
  await Promise.all([a.done, b.done]);
  checks.distinctConversations = a.record?.id !== b.record?.id;
  checks.firstAnswer = /MARIGOLD/i.test(a.record?.turns.at(-1)?.answer ?? "");
  checks.secondAnswer = /HARBOR/i.test(b.record?.turns.at(-1)?.answer ?? "");
  checks.noCrossTalk =
    !/HARBOR/i.test(a.record?.turns.at(-1)?.answer ?? "") &&
    !/MARIGOLD/i.test(b.record?.turns.at(-1)?.answer ?? "");
  a.client.close();
  await c.readiness;
  checks.admittedAfterRelease = true;
  c.submit();
  await c.done;
  checks.thirdAnswer = /CITRINE/i.test(c.record?.turns.at(-1)?.answer ?? "");
  assert.ok(Object.values(checks).every(Boolean), JSON.stringify(checks));
}
try {
  await Promise.race([
    journey(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Hosted session test timed out")),
        120_000,
      );
    }),
  ]);
} catch (e) {
  failure = String(e);
  process.exitCode = 1;
} finally {
  clearTimeout(timer!);
  clients.forEach((c) => c.client.close());
  mkdirSync(directory, { recursive: true });
  const receipt = {
    checks,
    failure,
    records: clients.map((c) => c.record),
    sessions: clients.map((c) => c.events),
  };
  writeFileSync(
    directory + "/isolation-admission.json",
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify({ checks, failure }));
}
