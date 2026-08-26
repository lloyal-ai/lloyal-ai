const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let done = false;
const finish = (m, c) => { if (done) return; done = true; console.log(m); child.kill(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "config:loaded")
    finish(`origins=${JSON.stringify(ev.origin)}`, 0);
});
child.on("exit", () => finish("exited early", 1));
setTimeout(() => finish("timeout", 1), 120_000);
