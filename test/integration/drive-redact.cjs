// Save a secret via set_app_config(web); assert no event ever carries it.
const { fork } = require("node:child_process");
const child = fork("dist/targets/cli/index.mjs", [], {
  cwd: process.cwd(), env: { ...process.env, RR_BRIDGE: "1" },
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
const SECRET = "sk-super-secret-key";
let sent = false, done = false, leaked = false;
const finish = (c) => { if (done) return; done = true; child.kill(); process.exit(c); };
child.on("message", (m) => {
  const ev = m?.payload;
  if (!ev?.type) return;
  if (JSON.stringify(ev).includes(SECRET)) { leaked = true; console.log(`LEAK in ${ev.type}`); finish(1); }
  if (ev.type === "weights:done" && !sent) {
    sent = true;
    child.send({ t: "command", payload: { type: "set_app_config", name: "web", values: { tavilyKey: SECRET } } });
  } else if (ev.type === "config:updated") {
    console.log(`config:updated abilities=${JSON.stringify(ev.config.abilities)}`);
  } else if (sent && ev.type === "abilities:state") {
    const web = ev.abilities.find((a) => a.name === "web");
    console.log(`abilities:state web.config=${JSON.stringify(web?.config)}`);
    setTimeout(() => finish(leaked ? 1 : 0), 500);
  }
});
child.on("exit", () => finish(1));
setTimeout(() => finish(1), 180_000);
