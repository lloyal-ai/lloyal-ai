/** Exercise the real Glass host through the same public binding as the web UI.
 * This is a protocol test; it is not evidence of browser rendering or usability.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ingestMedia } from "@lloyal-labs/media";
import { connectWss } from "@lloyal-labs/binding/web";
import type { Command, WorkflowEvent } from "../../src/protocol.js";
import { initialState, reduce } from "../../src/ui/state.js";
import { streamedAnswer } from "../../src/ui/select.js";
import { Mode } from "../../src/domain/work.js";
const seed = Number(process.env.GLASS_SEED ?? 42);
const mode = Mode.parse(process.argv[2] ?? "Auto");
const query =
  process.argv[3] ??
  "Explain why rainbows form in three sentences. Use general knowledge only.";
const url = process.env.GLASS_WS ?? "ws://127.0.0.1:8788/";
const dir = process.env.GLASS_RECEIPTS ?? "verification/native";
mkdirSync(dir, { recursive: true });
const fixture = process.env.GLASS_FIXTURE;
const attachments = fixture
  ? [
      await ingestMedia(
        new URL(url.replace(/^ws/, "http")).origin,
        new Uint8Array(readFileSync(fixture)),
      ),
    ]
  : [];
const started = Date.now(),
  events: { ms: number; event: WorkflowEvent }[] = [];
let state = initialState,
  submitted = 0,
  useful = 0;
const reopen = process.env.GLASS_CONVERSATION;
const finishOnPlan = process.env.GLASS_FINISH_ON_PLAN === "1";
// An empty override keeps every installed ability available. Omission isolates fixture tests.
const excluded =
  process.env.GLASS_EXCLUDED !== undefined
    ? process.env.GLASS_EXCLUDED.split(",").filter(Boolean)
    : [
        "web",
        "wikipedia",
        "corpus",
        ...(attachments.length || reopen ? [] : ["documents"]),
      ];
function submit() {
  submitted = Date.now();
  client.send({
    type: "submit_query",
    query,
    mode,
    attachments,
    excluded,
    ...(reopen
      ? {
          conversationId: reopen,
          revision: state.conversations[reopen].revision,
        }
      : {}),
  });
}
let finish!: () => void;
const done = new Promise<void>((resolve) => {
  finish = resolve;
});
let timedOut = false,
  grace: ReturnType<typeof setTimeout> | undefined;
const client = connectWss<WorkflowEvent, Command>(url, {
  onReady() {
    client.send({ type: "set_config", patch: { sampling: { seed } } });
    if (reopen) client.send({ type: "open_conversation", id: reopen });
    else submit();
  },
  onEvent(event) {
    events.push({ ms: Date.now() - started, event });
    state = reduce(state, event);
    if (reopen && !submitted && event.type === "conversation:active") submit();
    if (
      !useful &&
      (event.type === "work:plan" ||
        (event.type === "agent:produce" &&
          state.work?.keys[event.agentId] === "answer" &&
          !!streamedAnswer(state)))
    )
      useful = Date.now();
    if (event.type === "work:plan" && event.state.awaitingApproval) {
      if (event.state.problem) client.send({ type: "stop" });
      else if (finishOnPlan)
        client.send({ type: "finish_work", turnId: state.work!.turnId });
      else
        client.send({
          type: "approve_plan",
          turnId: state.work!.turnId,
          revision: event.state.revision,
        });
    }
    if (event.type === "work:ended") finish();
  },
  onSession(session) {
    console.log("session", session);
  },
  onClose() {
    finish();
  },
});
const timer = setTimeout(() => {
  timedOut = true;
  client.send({ type: "stop" });
  grace = setTimeout(finish, 15_000);
}, 360_000);
await done;
clearTimeout(timer);
clearTimeout(grace);
client.close();
const record = state.work
  ? state.conversations[state.work.conversationId]
  : undefined;
const receipt = {
  seed,
  mode,
  query,
  fixture,
  attachments,
  excluded,
  finishOnPlan,
  startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  submittedMs: submitted - started,
  firstUsefulMs: useful ? useful - submitted : null,
  timedOut,
  record,
  events,
};
const path = join(
  dir,
  `${new Date(started).toISOString().replace(/[:.]/g, "-")}-${mode.toLowerCase()}.json`,
);
writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n");
const turn = record?.turns.at(-1);
console.log(
  JSON.stringify({
    path,
    status: turn?.status,
    answer: turn?.answer,
    reason: turn?.reason,
    durationMs: receipt.durationMs,
  }),
);
const expectedStatus = finishOnPlan ? "partial" : "complete";
if (timedOut || turn?.status !== expectedStatus) process.exitCode = 1;
