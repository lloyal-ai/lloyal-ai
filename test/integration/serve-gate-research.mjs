// Served gate (research): per-session config isolation + wire redaction + #110 containment.
//   1. A,B admitted concurrently
//   2. A sets web.tavilyKey=SECRET -> config:updated on A ONLY, redacted; SECRET on NEITHER wire
//   3. fresh C admits -> its config:loaded shows PRISTINE abilities (A's save was per-session)
//   4. B sets a bad corpus path -> ui:error on B only; then an EMPTY corpus (enable-fail #110) -> host ALIVE
import { spawn } from "node:child_process";
import { connectWss } from "@lloyal-labs/binding/web";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET = "tvly-SUPERSECRET-e2e-gate-9x7q";
const log = (m) => console.log(`[gate] ${m}`);
// Dedicated port: an ambient dev tab retrying ws://8787 would admit a
// phantom session and poison the isolation/cap assertions.
const emptyDir = mkdtempSync(join(tmpdir(), "empty-corpus-"));
process.on("exit", () => { try { rmSync(emptyDir, { recursive: true, force: true }); } catch {} });
const host = spawn("node", ["bin/serve.js"], { env: { ...process.env, PORT: "18787" }, stdio: ["ignore", "pipe", "pipe"] });
// Drain both pipes: llama.cpp's boot/session logging otherwise fills the 64KB
// pipe buffer and BLOCKS the host — a false timeout that looks like a hang.
host.stdout.resume();
host.stderr.resume();
let hostDead = false;
host.on("exit", (c) => { hostDead = true; log(`host exited ${c}`); });
const die = (m) => { log(`FAIL: ${m}`); host.kill("SIGKILL"); process.exit(1); };
let secretOnWire = 0;

function open(name) {
  const s = { name, ready: false, loaded: null, updated: [], errors: [], events: 0, client: null };
  s.connect = () => {
    s.client = connectWss("ws://127.0.0.1:18787", {
      onEvent: (ev) => {
        s.events++;
        if (JSON.stringify(ev).includes(SECRET)) { secretOnWire++; log(`SECRET ON ${name}'s WIRE: ${ev.type}`); }
        if (ev?.type === "weights:done") s.ready = true;
        if (ev?.type === "config:loaded") s.loaded = ev;
        if (ev?.type === "config:updated") s.updated.push(ev);
        if (ev?.type === "ui:error") s.errors.push(ev.message);
      },
      onClose: () => { if (!s.ready) setTimeout(s.connect, 1000); },
    });
  };
  s.connect();
  return s;
}
const until = async (label, pred, ms = 120_000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (hostDead) die(`host died waiting for: ${label}`);
    if (Date.now() - t0 > ms) die(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  log(`ok: ${label}`);
};

const A = open("A"), B = open("B");
await until("A+B admitted", () => A.ready && B.ready);

A.client.send({ type: "set_app_config", name: "web", values: { tavilyKey: SECRET } });
await until("A got config:updated", () => A.updated.length === 1);
const aWeb = JSON.stringify(A.updated[0].config.abilities?.web);
if (aWeb !== '{"tavilyKey":true}') die(`A's update not redacted-to-presence: ${aWeb}`);
log(`ok: A's update redacted (web=${aWeb})`);
await new Promise((r) => setTimeout(r, 2000));
if (B.updated.length !== 0) die(`B received A's config:updated (${B.updated.length})`);
log("ok: B saw NO config:updated from A's save");
if (secretOnWire) die("secret literal crossed a wire");
log("ok: secret literal on neither wire");

const C = open("C");
await until("C admitted", () => C.ready && C.loaded !== null);
const cWeb = JSON.stringify(C.loaded.config.abilities?.web ?? {});
if (cWeb.includes("tavilyKey")) die(`fresh C inherited A's session config: ${cWeb}`);
log(`ok: fresh C pristine (web=${cWeb}) — A's save was per-session`);

B.client.send({ type: "set_app_config", name: "corpus", values: { corpusPath: "/nonexistent-corpus-xyz" } });
await until("B got the path-guard error", () => B.errors.length === 1);
if (A.errors.length) die("A received B's error");
B.client.send({ type: "set_app_config", name: "corpus", values: { corpusPath: emptyDir } });
await until("B got the enable-fail error (#110 path)", () => B.errors.length === 2, 180_000);
if (!/no \.md\(x\) files matched/.test(B.errors[1])) die(`second error was not the ENABLE failure: ${B.errors[1]}`);
if (A.errors.length || C.errors.length) die("B's errors leaked to a sibling");
if (C.updated.length) die("C received a config:updated it never caused");
log(`ok: B errors isolated to B (A and C clean): ${B.errors.map((e) => e.slice(0, 40)).join(" | ")}`);
await new Promise((r) => setTimeout(r, 1500));
if (hostDead) die("host died after corpus enable-fail (#110 REGRESSION)");
log("ok: host ALIVE after enable-fail — #110 contained through rig 5.3.0");

A.client.send({ type: "set_effort", effort: "low" });
await until("A still serviceable after everything", () => A.updated.length === 2);
// Per-session isolation holds to the END: A's second update must not have
// broadcast to either sibling.
if (B.updated.length || C.updated.length) die(`A's set_effort broadcast to a sibling (B=${B.updated.length} C=${C.updated.length})`);
// The counter runs for the WHOLE gate: a raw secret serialized into any later
// frame (A's second update, B's errors, C's load) must still fail it.
if (secretOnWire) die("secret literal appeared on a wire AFTER the initial redaction check");
log("PASS: per-session isolation + wire redaction + #110 containment on the served path");
host.kill("SIGKILL");
process.exit(0);
