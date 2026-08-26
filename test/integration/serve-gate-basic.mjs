// Headless serving gate (basic template):
//   1. A and B admitted + STREAMING CONCURRENTLY (interleaved produces)
//   2. A's socket dropped mid-run -> B streams on to a FULL answer
//   3. fresh D admits after the release and starts producing
//   4. host process alive throughout
import { spawn } from "node:child_process";
import { connectWss } from "@lloyal-labs/binding/web";

const log = (m) => console.log(`[gate] ${new Date().toISOString().slice(11, 19)} ${m}`);
// MAX_SESSIONS=2: A+B fill capacity, so D can ONLY admit if dropping A
// actually released its slot — with the default cap of 4 this gate would
// pass even if release were broken. Dedicated port: an ambient dev tab
// retrying ws://8787 would admit a phantom session and eat a slot.
const host = spawn("node", ["bin/serve.js"], {
  env: { ...process.env, MAX_SESSIONS: "2", PORT: "18787" },
  stdio: ["ignore", "pipe", "pipe"],
});
// Drain both pipes: llama.cpp's boot/session logging otherwise fills the 64KB
// pipe buffer and BLOCKS the host — a false timeout that looks like a hang.
host.stdout.resume();
host.stderr.resume();
let hostDead = false;
host.on("exit", (c) => { hostDead = true; log(`host exited ${c}`); });
const die = (m) => { log(`FAIL: ${m}`); host.kill("SIGKILL"); process.exit(1); };
process.on("unhandledRejection", (e) => die(e.message ?? e));

function open(name, query) {
  const s = { name, produced: 0, answer: null, closed: false, ready: false, client: null };
  s.connect = () => {
    s.client = connectWss("ws://127.0.0.1:18787", {
      onEvent: (ev) => {
        if (ev?.type === "ready") { s.ready = true; s.client.send({ type: "submit_query", query }); }
        if (ev?.type === "agent:produce") s.produced++;
        if (ev?.type === "answer") { s.answer = ev.text; log(`${name}: ANSWER (${s.produced} produces): ${ev.text.slice(0, 50)}...`); }
        if (ev?.type === "error") die(`${name} harness error: ${ev.message}`);
      },
      onClose: () => { s.closed = true; if (!s.ready) setTimeout(s.connect, 1000); },
    });
  };
  s.connect();
  return s;
}
const until = async (label, pred, ms) => {
  const t0 = Date.now();
  while (!pred()) {
    if (hostDead) die(`host died waiting for: ${label}`);
    if (Date.now() - t0 > ms) die(`timeout waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  log(`ok: ${label} (${Math.round((Date.now() - t0) / 1000)}s)`);
};

const A = open("A", "capital of France");
const B = open("B", "largest planet in the solar system");
await until("A and B both admitted (ready)", () => A.ready && B.ready, 120_000);
const [a0, b0] = [A.produced, B.produced];
await until("A and B produce CONCURRENTLY (+10 each)", () => A.produced >= a0 + 10 && B.produced >= b0 + 10, 180_000);

log(`dropping A mid-run at ${A.produced} produces`);
A.client.close();
const bMark = B.produced;
await until("B still streaming after A dropped (+10)", () => B.produced >= bMark + 10, 120_000);
await until("B full answer", () => B.answer !== null, 600_000);

const D = open("D", "speed of light in a vacuum");
await until("D admitted on the freed slot (ready)", () => D.ready, 120_000);
await until("D streaming (+5)", () => D.produced >= 5, 120_000);
if (hostDead) die("host died");
log("PASS: concurrent admission + mid-run disconnect isolation + re-admission, host alive");
host.kill("SIGKILL");
process.exit(0);
