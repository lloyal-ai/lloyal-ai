// Drive the wiki harness over the desktop ipc surface: fork → ready → one query → done.
const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.js", [], {
  cwd: process.cwd(),
  env: { ...process.env, RR_BRIDGE: "1", LLOYAL_DEV: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let done = false;
const finish = (why) => {
  if (done) return; done = true;
  console.log(`[driver] finish: ${why}`);
  child.kill(); process.exit(why === "answer" ? 0 : 1);
};
child.on("message", (m) => {
  const t = m?.t, ev = m?.payload;
  if (t === "ready" || ev?.type === "ready") {
    console.log("[driver] ready — sending query");
    child.send({ t: "command", payload: { type: "submit_query", query: "capital of France" } });
  } else if (ev?.type) {
    if (ev.type !== "token" && ev.type !== "agent:produce") console.log(`[driver] event: ${ev.type}`);
    if (ev.type === "answer" || ev.type === "error") finish(ev.type === "answer" ? "answer" : `error: ${ev.message}`);
  }
});
child.on("exit", (c) => finish(`child exited ${c}`));
setTimeout(() => finish("timeout 480s"), 480_000);
