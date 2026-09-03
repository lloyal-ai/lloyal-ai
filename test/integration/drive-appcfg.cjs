// set_app_config with a bad corpus path: expect ui:error and NO config:updated
// / abilities:state after it (enable-failure rollback), then exit.
const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let sent = false, done = false, sawError = false;
const finish = (c) => { if (done) return; done = true; child.kill(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "weights:done" && !sent) {
    sent = true;
    child.send({ t: "command", payload: { type: "set_app_config", name: "corpus", values: { corpusPath: "/nonexistent-corpus-xyz" } } });
  } else if (sent && ev?.type === "ui:error") {
    sawError = true;
    console.log(`ui:error: ${ev.message}`);
    setTimeout(() => finish(0), 1500); // allow any (wrong) trailing events to surface
  } else if (sent && sawError && (ev?.type === "config:updated" || ev?.type === "abilities:state")) {
    console.log(`UNEXPECTED after error: ${ev.type}`); finish(1);
  } else if (sent && !sawError && ev?.type === "config:updated") {
    console.log("UNEXPECTED: save went through"); finish(1);
  }
});
child.on("exit", () => finish(sawError ? 0 : 1));
setTimeout(() => finish(1), 180_000);
