// Re-enable AFTER a rollback: a bad corpus config rolls back (hdk#110), then a
// GOOD config on the same ability must enable cleanly — config:updated AND the
// corpus actually indexes. Self-provisioning: builds both fixture dirs and
// restores any harness.json state it caused.
const { fork } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-corpus-"));
const goodDir = fs.mkdtempSync(path.join(os.tmpdir(), "good-corpus-"));
fs.writeFileSync(path.join(goodDir, "a.md"), "# Alpha\n\nThe alpha document.\n");
fs.writeFileSync(path.join(goodDir, "b.md"), "# Beta\n\nThe beta document.\n");
const priorJson = fs.existsSync("harness.json") ? fs.readFileSync("harness.json") : null;
const cleanup = () => {
  try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(goodDir, { recursive: true, force: true }); } catch {}
  try { priorJson === null ? fs.unlinkSync("harness.json") : fs.writeFileSync("harness.json", priorJson); } catch {}
};
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let step = 0, done = false, updated = false, indexed = false;
process.on("exit", cleanup); // belt: restore even on an unexpected path
const finish = (c) => { if (done) return; done = true; child.kill(); cleanup(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "weights:done" && step === 0) {
    step = 1;
    child.send({ t: "command", payload: { type: "set_app_config", name: "corpus", values: { corpusPath: emptyDir } } });
  } else if (ev?.type === "ui:error" && step === 1) {
    console.log(`step1 rolled back: ${ev.message}`);
    step = 2;
    child.send({ t: "command", payload: { type: "set_app_config", name: "corpus", values: { corpusPath: goodDir } } });
  } else if (step === 2) {
    // config:updated and corpus:indexed arrive in either order — need BOTH.
    if (ev?.type === "config:updated") {
      updated = true;
      console.log(`step2 re-enabled: corpus=${JSON.stringify(ev.config.abilities.corpus)}`);
    } else if (ev?.type === "corpus:indexed") {
      indexed = true;
      console.log(`step2 indexed: files=${ev.fileCount}`);
    }
    if (updated && indexed) finish(0);
  }
});
child.on("exit", (c) => { console.log(`ENGINE EXITED ${c}`); finish(1); });
setTimeout(() => finish(1), 180_000);
