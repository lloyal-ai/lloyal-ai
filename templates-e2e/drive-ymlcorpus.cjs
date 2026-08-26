const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let done = false; let sawCorpus = false;
const finish = (c) => { if (done) return; done = true; child.kill(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "corpus:indexed") { sawCorpus = true; console.log(`corpus:indexed files=${ev.fileCount}`); }
  if (ev?.type === "config:loaded") console.log(`config:loaded abilities=${JSON.stringify(ev.config.abilities)}`);
  if (ev?.type === "abilities:state") {
    console.log(`abilities:state: ${ev.abilities.map(a => a.name).join(", ")}`);
    finish(sawCorpus ? 0 : 1);
  }
});
child.on("exit", () => finish(1));
setTimeout(() => finish(1), 120_000);
