// The previously-unreachable path: an existing-but-EMPTY corpus dir passes the
// existence guard, enable THROWS (rig >= 5.2.1 throws instead of exiting), and
// the rollback restores the store/registry/disk with the process ALIVE
// (hdk#110). Self-provisioning: creates its own empty dir.
const { fork } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-corpus-"));
const cleanup = () => {
  try { fs.rmSync(emptyDir, { recursive: true, force: true }); } catch {}
  // The harness's rollback restores the VALUE but writes the file (an absent
  // prior becomes `abilities: { corpus: {} }` on disk — its shipped
  // semantics). Restore the scaffold's exact prior state so the battery
  // stays sequence-safe.
  try { priorJson === null ? fs.unlinkSync("harness.json") : fs.writeFileSync("harness.json", priorJson); } catch {}
};
// The rollback contract restores DISK state too: snapshot harness.json (or
// its absence) and require the VALUE unchanged after the failed enable.
const priorJson = fs.existsSync("harness.json") ? fs.readFileSync("harness.json", "utf8") : null;
process.on("exit", cleanup); // belt: clean even on an interrupt
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let sent = false, done = false;
const finish = (c) => { if (done) return; done = true; child.kill(); cleanup(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "weights:done" && !sent) {
    sent = true;
    child.send({ t: "command", payload: { type: "set_app_config", name: "corpus", values: { corpusPath: emptyDir } } });
  } else if (sent && ev?.type === "ui:error") {
    console.log(`ui:error: ${ev.message}`);
    // Must be the ENABLE failure (rollback path), not the existence guard.
    if (!/no \.md\(x\) files matched/.test(ev.message)) { console.log("wrong error: path guard, not enable-fail"); finish(1); return; }
    setTimeout(() => {
      const nowJson = fs.existsSync("harness.json") ? fs.readFileSync("harness.json", "utf8") : null;
      const restored = priorJson === null
        ? nowJson === null || !/corpusPath/.test(nowJson)
        : nowJson === priorJson;
      console.log(restored ? "disk rolled back ✓" : `DISK NOT ROLLED BACK: ${nowJson}`);
      finish(restored ? 0 : 1);
    }, 1000);
  }
});
child.on("exit", (code) => { console.log(`ENGINE EXITED code=${code} (containment failed)`); finish(1); });
setTimeout(() => finish(1), 120_000);
