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
    child.send({ t: "command", payload: { type: "set_output_dir", path: "x" } });
  } else if (ev?.type === "ui:error") {
    console.log(`ui:error: ${ev.message}`); finish(0);
  } else if (ev?.type === "config:updated") {
    console.log(`config:updated savedTo=${ev.savedTo} (SAVE WENT THROUGH)`); finish(1);
  }
});
child.on("exit", () => finish(1));
setTimeout(() => finish(1), 180_000);
