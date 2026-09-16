/**
 * What the model is told, seven files. The `.eta` sources are inlined as text
 * at build time (esbuild `--loader:.eta=text`; the test rig's loader hook does
 * the same), so nothing here reads a file. Each file is a system prompt, a
 * `---` line, and a user template rendered with Eta.
 */
import PLAN_RAW from "./prompts/plan.eta";
import PLAN_FLAT_RAW from "./prompts/plan-flat.eta";
import PREFLIGHT_RAW from "./prompts/preflight.eta";
import PREFLIGHT_RECOVER_RAW from "./prompts/preflight-recover.eta";
import RECOVERY_RAW from "./prompts/recovery.eta";
import SYNTHESIZE_RAW from "./prompts/synthesize.eta";
import SYNTHESIZE_FLAT_RAW from "./prompts/synthesize-flat.eta";

export type Prompt = { system: string; user: string };

function parse(raw: string): Prompt {
  const trimmed = raw.trim();
  const sep = trimmed.indexOf("\n---\n");
  if (sep === -1) return { system: trimmed, user: "" };
  return { system: trimmed.slice(0, sep).trim(), user: trimmed.slice(sep + 5).trim() };
}

export const PROMPTS = {
  plan: parse(PLAN_RAW),
  planFlat: parse(PLAN_FLAT_RAW),
  preflight: parse(PREFLIGHT_RAW),
  preflightRecover: parse(PREFLIGHT_RECOVER_RAW),
  recovery: parse(RECOVERY_RAW),
  synthesize: parse(SYNTHESIZE_RAW),
  synthesizeFlat: parse(SYNTHESIZE_FLAT_RAW),
} as const;
