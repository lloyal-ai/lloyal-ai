/** The terminal view's obligations: ctrl+c says `quit` on the wire, so the command loop ends and the process
 *  with it (Ink would otherwise take ctrl+c for itself — the view would vanish and the harness would wait for a
 *  command that never comes); and a run that found nothing is said, never shown as the answer that stood before. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createBus } from "@lloyal-labs/binding";
import { renderCli } from "../../src/ui/cli.js";
import { NOTHING_KEPT } from "../../src/ui/presentation.js";
import type { Command, WorkflowEvent } from "../../src/brief/protocol.js";

/** What Ink asks of a terminal: a readable it can put in raw mode, and a writable with a size. */
function terminal(): { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream; keys: (s: string) => void; shown: () => string } {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin });
  // A TTY on both sides: Ink draws frames only for a terminal, and writes a non-TTY once, at unmount.
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
  let out = "";
  stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
  return { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, keys: (s) => { stdin.write(s); }, shown: () => out };
}
const until = async (what: () => boolean): Promise<void> => { for (let i = 0; i < 200 && !what(); i++) await new Promise((r) => setTimeout(r, 10)); };

test("ctrl+c in the terminal view says quit on the wire", async () => {
  const bus = createBus<WorkflowEvent>();
  const sent: Command[] = [];
  const io = terminal();
  const dispose = renderCli(bus, (c) => { sent.push(c); }, [], io);
  try {
    await new Promise((r) => setTimeout(r, 200));   // a frame's worth of time for the view to mount and listen
    io.keys("\x03");
    await until(() => sent.some((c) => c.type === "quit"));
    assert.ok(sent.some((c) => c.type === "quit"), `ctrl+c reached the view, and it said: ${JSON.stringify(sent)}`);
  } finally {
    dispose();
  }
});

const A = "2026-09-02T10-00-00-000";
const settled: WorkflowEvent[] = [
  { type: "query", docId: A, query: "Q1", warm: false },
  { type: "plan:start", query: "Q1", mode: "flat" },
  { type: "plan", intent: "research", tasks: [{ description: "a" }], clarifyQuestions: [], tokenCount: 1, timeMs: 1 },
  { type: "research:start", agentCount: 1, mode: "flat", reports: null },
  { type: "answer", text: "THE ROOT ANSWER" },
  { type: "complete", data: {} },
];

test("a follow-up that found nothing is said in the terminal, not shown as the root answer; so is a brief that found nothing", async () => {
  const bus = createBus<WorkflowEvent>();
  const io = terminal();
  const dispose = renderCli(bus, () => {}, [
    ...settled,
    { type: "query", docId: A, query: "and then?", warm: true },
    { type: "research:start", agentCount: 1, mode: "flat", reports: null },
    { type: "answer", text: null },
    { type: "complete", data: {} },
  ], io);
  try {
    await until(() => io.shown().includes(NOTHING_KEPT));
    const frame = io.shown();
    assert.ok(frame.includes(NOTHING_KEPT), "the words for nothing found");
    assert.ok(!frame.includes("THE ROOT ANSWER"), "the root answer was shown as if it answered the follow-up");
  } finally {
    dispose();
  }
  const cold = terminal();
  const disposeCold = renderCli(createBus<WorkflowEvent>(), () => {}, [
    { type: "query", docId: A, query: "Q1", warm: false },
    { type: "plan:start", query: "Q1", mode: "flat" },
    { type: "research:start", agentCount: 1, mode: "flat", reports: null },
    { type: "answer", text: null },
    { type: "complete", data: {} },
  ], cold);
  try {
    await until(() => cold.shown().includes(NOTHING_KEPT));
    assert.ok(cold.shown().includes(NOTHING_KEPT), "a cold brief that found nothing says so instead of an empty screen");
  } finally {
    disposeCold();
  }
});
