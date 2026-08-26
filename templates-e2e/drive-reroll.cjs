const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let step = 0, done = false;
const finish = (c) => { if (done) return; done = true; child.kill(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "ui:composer" && step === 0) {
    step = 1;
    child.send({ t: "command", payload: { type: "set_app_config", name: "corpus", values: { corpusPath: "/tmp/good-corpus" } } });
  } else if (ev?.type === "config:updated" && step === 1) {
    console.log(`step1 ok: corpus configured (${JSON.stringify(ev.config.abilities.corpus)})`);
    step = 2;
    child.send({ t: "command", payload: { type: "set_app_config", name: "corpus", values: { corpusPath: "/tmp/empty-corpus-probe" } } });
  } else if (ev?.type === "ui:error" && step === 2) {
    console.log(`step2 refused: ${ev.message}`);
    setTimeout(() => finish(0), 1000);
  }
});
child.on("exit", (c) => { console.log(`ENGINE EXITED ${c}`); finish(1); });
setTimeout(() => finish(1), 180_000);
