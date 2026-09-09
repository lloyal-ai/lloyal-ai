// Boot research over ipc; after weights:done, send set_effort and print the
// config:updated payload — the yml-sourced fields surviving proves threading.
const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(),
  env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let sent = false, done = false;
const finish = (msg, code) => { if (done) return; done = true; console.log(msg); child.kill(); process.exit(code); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "weights:done" && !sent) {
    sent = true;
    child.send({ t: "command", payload: { type: "set_effort", effort: "medium" } });
  } else if (ev?.type === "config:updated") {
    finish(`config:updated defaults=${JSON.stringify(ev.config.defaults)} sources=${JSON.stringify(ev.config.sources)} gpu=${JSON.stringify(ev.config.model.gpu)} savedTo=${JSON.stringify(ev.savedTo)}`, 0);
  }
});
child.on("exit", () => finish("child exited early", 1));
setTimeout(() => finish("timeout", 1), 180_000);
