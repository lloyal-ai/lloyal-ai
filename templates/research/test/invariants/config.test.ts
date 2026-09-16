/**
 * The gates `harness.yml` commits a scope for are gates the web ability declares:
 * a renamed gate would otherwise leave the committed scope silently unapplied.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { run } from "effection";
import { AbilityConfigStoreCtx } from "@lloyal-labs/lloyal-agents";
import { createInMemoryConfigStore } from "@lloyal-labs/rig";
import { loadYml } from "@lloyal-labs/rig/node";
import { createWebAbility } from "@lloyal-labs/web-ability";
import { config } from "../../src/app.js";

test("every gate harness.yml names is one the web ability declares", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const named = Object.keys((loadYml(config, root).defaults?.guards as Record<string, unknown> | undefined) ?? {});
  assert.ok(named.length > 0, "harness.yml commits the research scope for the web gates");
  const web = await run(function* () {
    const store = createInMemoryConfigStore();
    yield* store.set("web", { tavilyKey: "test-key" });
    yield* AbilityConfigStoreCtx.set(store);
    return yield* createWebAbility();
  });
  const declared = web.tools.flatMap((t) => t.hooks?.beforeDispatch ?? []).map((g) => g.name);
  for (const name of named) assert.ok(declared.includes(name), `${name} is not a gate the web ability declares (${declared.join(", ")})`);
});
