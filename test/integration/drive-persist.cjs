// Sequence: composer → set_output_dir → set_effort → print each config:updated, exit.
const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let step = 0, done = false;
const finish = (c) => { if (done) return; done = true; child.kill(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "config:loaded") {
    console.log(`loaded: origins=${JSON.stringify(ev.origin)} defaults=${JSON.stringify(ev.config.defaults)} outputDir=${JSON.stringify(ev.config.sources.outputDir)}`);
  } else if (ev?.type === "ui:composer" && step === 0) {
    step = 1;
    child.send({ t: "command", payload: { type: "set_output_dir", path: "out" } });
  } else if (ev?.type === "config:updated" && step === 1) {
    console.log(`save1: savedTo=${JSON.stringify(ev.savedTo)} gitignored=${ev.gitignored} origin.outputDir=${ev.origin.outputDir}`);
    step = 2;
    child.send({ t: "command", payload: { type: "set_effort", effort: "low" } });
  } else if (ev?.type === "config:updated" && step === 2) {
    console.log(`save2: savedTo=${JSON.stringify(ev.savedTo)} gitignored=${ev.gitignored} effort=${ev.config.defaults.effort} origin.gpu=${ev.origin.gpu}`);
    finish(0);
  }
});
child.on("exit", () => finish(1));
setTimeout(() => { console.log("timeout"); finish(1); }, 180_000);
