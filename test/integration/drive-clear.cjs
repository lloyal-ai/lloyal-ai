const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let step = 0, done = false;
const finish = (c) => { if (done) return; done = true; child.kill(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "weights:done" && step === 0) {
    step = 1;
    child.send({ t: "command", payload: { type: "set_output_dir", path: "localdir" } });
  } else if (ev?.type === "config:updated" && step === 1) {
    console.log(`set:   value=${JSON.stringify(ev.config.sources.outputDir)} origin=${ev.origin.outputDir}`);
    step = 2;
    child.send({ t: "command", payload: { type: "set_output_dir", path: "" } });
  } else if (ev?.type === "config:updated" && step === 2) {
    console.log(`clear: value=${JSON.stringify(ev.config.sources.outputDir)} origin=${ev.origin.outputDir}`);
    finish(0);
  }
});
child.on("exit", () => finish(1));
setTimeout(() => finish(1), 180_000);
