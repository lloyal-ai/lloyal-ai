// The previously-unreachable path: an existing-but-EMPTY corpus dir passes the
// existence guard, enable THROWS (rig >= 5.2.1 throws instead of exiting), and
// the rollback restores the store/registry/disk with the process ALIVE
// (hdk#110). Self-provisioning: creates its own empty dir.
const { fork } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-corpus-"));
const cleanup = () => { try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch {} };
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let sent = false, done = false;
const finish = (c) => { if (done) return; done = true; child.kill(); cleanup(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "ui:composer" && !sent) {
    sent = true;
    child.send({ t: "command", payload: { type: "set_app_config", name: "corpus", values: { corpusPath: emptyDir } } });
  } else if (sent && ev?.type === "ui:error") {
    console.log(`ui:error: ${ev.message}`);
    setTimeout(() => finish(0), 1000);
  }
});
child.on("exit", (code) => { console.log(`ENGINE EXITED code=${code} (containment failed)`); finish(1); });
setTimeout(() => finish(1), 120_000);
