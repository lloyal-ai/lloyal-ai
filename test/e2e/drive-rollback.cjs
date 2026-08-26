// The previously-unreachable path: existing-but-empty corpus dir passes the
// existence guard, enable THROWS (patched rig), rollback restores the disk.
const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let sent = false, done = false;
const finish = (c) => { if (done) return; done = true; child.kill(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "ui:composer" && !sent) {
    sent = true;
    child.send({ t: "command", payload: { type: "set_app_config", name: "corpus", values: { corpusPath: "/tmp/empty-corpus-probe" } } });
  } else if (sent && ev?.type === "ui:error") {
    console.log(`ui:error: ${ev.message}`);
    setTimeout(() => finish(0), 1000);
  }
});
child.on("exit", (code) => { console.log(`ENGINE EXITED code=${code} (containment failed)`); finish(1); });
setTimeout(() => finish(1), 120_000);
