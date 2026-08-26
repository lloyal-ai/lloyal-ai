// One query over ipc; print the FIRST agent:produce payload keys, then exit.
const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.js", [], {
  cwd: process.cwd(),
  env: { ...process.env, RR_BRIDGE: "1", LLOYAL_DEV: process.env.DEV_FLAG ?? "" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let sent = false, done = false;
const finish = (msg, code) => { if (done) return; done = true; console.log(msg); child.kill(); process.exit(code); };
child.on("message", (m) => {
  const ev = m?.payload;
  if ((m?.t === "ready" || ev?.type === "ready") && !sent) {
    sent = true;
    child.send({ t: "command", payload: { type: "submit_query", query: "capital of France" } });
  } else if (ev?.type === "agent:produce") {
    finish(`produce keys: ${Object.keys(ev).sort().join(",")}  entropy=${ev.entropy} surprisal=${ev.surprisal}`, 0);
  }
});
child.on("exit", () => finish("child exited before produce", 1));
setTimeout(() => finish("timeout", 1), 300_000);
