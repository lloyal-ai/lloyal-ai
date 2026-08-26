// A COMMITTED yml `abilities:` corpus must enable + index at boot (the deploy-
// declared rung). Self-provisioning: builds a corpus fixture inside the
// scaffold, appends the abilities block to harness.yml, and restores the
// original yml on exit.
const { fork } = require("node:child_process");
const fs = require("node:fs");
const priorYml = fs.readFileSync("harness.yml", "utf8");
fs.mkdirSync("corpus-fixture-ymlgate", { recursive: true });
fs.writeFileSync("corpus-fixture-ymlgate/a.md", "# Alpha\n\nThe alpha document.\n");
fs.writeFileSync("corpus-fixture-ymlgate/b.md", "# Beta\n\nThe beta document.\n");
fs.appendFileSync("harness.yml", '\nabilities:\n  corpus:\n    corpusPath: "./corpus-fixture-ymlgate"\n');
const cleanup = () => {
  try { fs.writeFileSync("harness.yml", priorYml); } catch {}
  try { fs.rmSync("corpus-fixture-ymlgate", { recursive: true, force: true }); } catch {}
};
process.on("exit", cleanup); // belt: restore the tracked yml even on an interrupt
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let done = false; let sawCorpus = false;
const finish = (c) => { if (done) return; done = true; child.kill(); cleanup(); process.exit(c); };
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
