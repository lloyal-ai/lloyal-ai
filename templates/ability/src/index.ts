/**
 * `@__PUBLISHER__/__NAME__-ability` — HDK ability: __NAME__ research.
 *
 * An ability = its declarative manifest (`ability.json`) + a `setup` that constructs the
 * runtime pieces. `defineAbility` pairs them and returns the factory the harness
 * enables; it also advertises the manifest, so the harness can provision any
 * models you declare in `services` (e.g. a reranker) before enabling.
 *
 * To customize for your domain: edit `ability.json` (name, `useWhen`, `services`),
 * the tool `dispatch` bodies in `src/tools/`, and the per-spawn skill template
 * `skill.eta`.
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Tool } from "@lloyal-labs/lloyal-agents";
import type { AbilityManifest } from "@lloyal-labs/rig";
import { defineAbility } from "@lloyal-labs/rig";
import { __NAME_PASCAL__Source } from "./source";

export { __NAME_PASCAL__Source } from "./source";

// The declarative manifest + skill template, read once at module load.
const dir = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(dir, "ability.json"), "utf8")) as AbilityManifest;
const skill = readFileSync(join(dir, "skill.eta"), "utf8");

/**
 * Construct the __NAME__ research ability. The setup reads any config/services it
 * needs, builds the source + tools, and returns them; `defineAbility` validates and
 * assembles the Ability when the harness enables it.
 */
export const create__NAME_PASCAL__App = defineAbility(manifest, function* () {
  const source = new __NAME_PASCAL__Source();
  const tools: Record<string, Tool> = {};
  for (const t of source.tools) tools[t.name] = t;

  return { source, tools, skill };
});
