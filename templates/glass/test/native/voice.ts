/** Public command/content-plane test using a synthetic recording, never a microphone. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { connectWss } from "@lloyal-labs/binding/web";
import { ingestMedia } from "@lloyal-labs/media";
import type { Command, WorkflowEvent } from "../../src/protocol.js";
const url = process.env.GLASS_WS ?? "ws://127.0.0.1:8790",
  dir = process.env.GLASS_RECEIPTS ?? "verification/audio";
mkdirSync(dir, { recursive: true });
const audio = await ingestMedia(
  new URL(url.replace(/^ws/, "http")).origin,
  new Uint8Array(readFileSync("test/fixtures/dictation.wav")),
);
const events: WorkflowEvent[] = [];
let finish!: () => void;
const done = new Promise<void>((r) => (finish = r));
const client = connectWss<WorkflowEvent, Command>(url, {
  onReady() {
    client.send({ type: "voice:describe" });
  },
  onEvent(event) {
    events.push(event);
    if (event.type === "voice:capabilities")
      event.capabilities.enabled
        ? client.send({
            type: "voice:transcribe",
            requestId: "cancel-first",
            audio,
          })
        : finish();
    if (event.type === "voice:progress" && event.requestId === "cancel-first")
      client.send({ type: "voice:cancel", requestId: "cancel-first" });
    if (event.type === "voice:cancelled" && event.requestId === "cancel-first")
      client.send({
        type: "voice:transcribe",
        requestId: "complete-second",
        audio,
      });
    if (event.type === "voice:error" || event.type === "voice:result") finish();
  },
  onClose() {
    finish();
  },
});
const timer = setTimeout(finish, 120_000);
await done;
clearTimeout(timer);
client.close();
writeFileSync(
  dir + "/voice-events.json",
  JSON.stringify({ audio, events }, null, 2),
);
const result = events.find((e) => e.type === "voice:result");
assert.ok(
  events.some(
    (e) => e.type === "voice:cancelled" && e.requestId === "cancel-first",
  ),
);
assert.ok(
  result?.type === "voice:result",
  "No successful transcript: inspect voice-events.json",
);
assert.equal(result.requestId, "complete-second");
assert.match(result.result.text, /rainbow/i);
assert.match(result.result.text, /three sentences/i);
console.log(
  JSON.stringify({
    text: result.result.text,
    provenance: result.result.provenance,
    cancelledFirst: true,
  }),
);
