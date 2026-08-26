// A version-2 harness.json must be REFUSED byte-identical: the save errors,
// the file is untouched. Self-provisioning: writes the v2 fixture itself and
// compares content before/after IN-PROCESS — but refuses to clobber a real
// harness.json, so it only runs from a clean scaffold.
const { fork } = require("node:child_process");
const fs = require("node:fs");
if (fs.existsSync("harness.json")) {
  console.log("refusing to run: harness.json exists (would clobber your state)");
  process.exit(1);
}
const V2 = '{\n  "version": 2,\n  "fromTheFuture": "keep-me-intact"\n}\n';
fs.writeFileSync("harness.json", V2);
const cleanup = () => { try { fs.unlinkSync("harness.json"); } catch {} };
process.on("exit", cleanup); // belt: remove the fixture even on an interrupt
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
let sent = false, done = false;
const finish = (c) => { if (done) return; done = true; child.kill(); cleanup(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (ev?.type === "ui:composer" && !sent) {
    sent = true;
    child.send({ t: "command", payload: { type: "set_output_dir", path: "x" } });
  } else if (ev?.type === "ui:error") {
    console.log(`ui:error: ${ev.message}`);
    const after = fs.readFileSync("harness.json", "utf8");
    if (after !== V2) { console.log("FILE CHANGED despite the refusal"); finish(1); }
    console.log("byte-identical after refusal ✓");
    finish(0);
  } else if (ev?.type === "config:updated") {
    console.log(`config:updated savedTo=${ev.savedTo} (SAVE WENT THROUGH)`); finish(1);
  }
});
child.on("exit", () => finish(1));
setTimeout(() => finish(1), 180_000);
