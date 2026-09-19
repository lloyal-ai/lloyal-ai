/** The terminal view's one obligation to the harness: ctrl+c says `quit` on the wire, so the command loop ends
 *  and the process with it. Ink would otherwise take ctrl+c for itself — the view would vanish and the harness
 *  would wait for a command that never comes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createBus } from "@lloyal-labs/binding";
import { renderCli } from "../../src/ui/cli.js";
import type { Command, WorkflowEvent } from "../../src/brief/protocol.js";

/** What Ink asks of a terminal: a readable it can put in raw mode, and a writable with a size. */
function terminal(): { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream; keys: (s: string) => void } {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin });
  const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 30 });
  stdout.resume();
  return { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, keys: (s) => { stdin.write(s); } };
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
