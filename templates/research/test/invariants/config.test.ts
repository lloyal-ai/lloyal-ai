/**
 * The config, checked against what consumes it. The gates `harness.yml` commits a scope for are gates the
 * web ability declares: a renamed gate would otherwise leave the committed scope silently unapplied. And
 * every declared key says what it is, because the dev pane shows that sentence and nothing else does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { run } from "effection";
import { AbilityConfigStoreCtx, Services, createInMemoryConfigStore } from "@lloyal-labs/rig";
import { stubReranker } from "@lloyal-labs/rig/testing";
import { loadYml } from "@lloyal-labs/rig/node";
import { createWebAbility } from "@lloyal-labs/web-ability";
import { config } from "../../src/app.js";
import type { ConfigKey } from "@lloyal-labs/rig";

test("every gate harness.yml names is one the web ability declares", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const named = Object.keys((loadYml(config, root).defaults?.guards as Record<string, unknown> | undefined) ?? {});
  assert.ok(named.length > 0, "harness.yml commits the research scope for the web gates");
  const web = await run(function* () {
    const store = createInMemoryConfigStore();
    yield* store.set("web", { tavilyKey: "test-key" });
    yield* AbilityConfigStoreCtx.set(store);
    // The ability declares the reranker, so its factory reads one; what it does with it is not this test's.
    yield* Services.set({ reranker: stubReranker });
    return yield* createWebAbility();
  });
  const declared = web.tools.flatMap((t) => t.hooks?.beforeDispatch ?? []).map((g) => g.name);
  for (const name of named) assert.ok(declared.includes(name), `${name} is not a gate the web ability declares (${declared.join(", ")})`);
});

// ── What each key says of itself ────────────────────────────────────────────

/** Every key the app declares says what it is, in its own words: that sentence is what the dev pane shows
 *  beside the key, and the only place it lives. How a change applies and where it is set are the
 *  declaration's other fields, so the sentence says neither. */
test("every declared key describes itself, and leaves the how to its tier and its yml path", () => {
  for (const [key, decl] of Object.entries(config) as [string, ConfigKey][]) {
    assert.match(decl.describe ?? "", /\S.*\.$/, `${key} says nothing of itself`);
    assert.doesNotMatch(decl.describe!, /harness\.yml|restart|next run/i, `${key} says how, which is not its sentence's to say`);
  }
});
