/**
 * Write a chosen model into a scaffolded project's `harness.yml`.
 *
 * The single write path the `models:` verbs (`models:use`/`add`/`download`) and
 * the scaffolder share, so the manifest is never hand-edited. All of the YAML
 * lives in {@link harness-yml}; this file only knows what a model entry means.
 */
import { openHarnessYml, harnessYmlPath } from './harness-yml.js';

/** A model entry is `id` XOR `path` — a catalog id or a BYO `.gguf` path. */
export type ModelSpec = { id: string } | { path: string };

/** The roles a harness provisions: the trunk llm + an ability-declared reranker. */
export type Role = 'llm' | 'reranker';

export interface ModelChoice {
  /**
   * The trunk llm — either a catalog `id` (rig fetches + digest-verifies,
   * fail-closed) or a local `path` to a `.gguf` you already have (BYO, trusted
   * by possession). Path-shaped values are written as `path:`, everything else
   * as `id:` — see {@link isModelPath}.
   */
  llm: string;
  /** Optional `model.llm.context` (nCtx). Omit to leave the template default. */
  context?: number;
}

/**
 * A model value is a BYO **path** (not a catalog id) if it looks like a
 * filesystem path: it contains a slash, ends in `.gguf`, or starts with `~`.
 * Catalog ids are bare slugs (`qwen3.5-4b`) and stay ids even when unknown to
 * the vendored catalog, so the picker survives catalog drift. This is the fix
 * for the bug where a BYO `./x.gguf` was written as `id:` and rig then looked
 * for `models/llm/./x.gguf.gguf`.
 */
export function isModelPath(value: string): boolean {
  return /[\\/]/.test(value) || value.endsWith('.gguf') || value.startsWith('~');
}

/** Turn a raw model value into a spec, classifying id vs BYO path. */
export function specFromValue(value: string): ModelSpec {
  return isModelPath(value) ? { path: value } : { id: value };
}

/**
 * Write `model.<role>` in `<projectDir>/harness.yml`. A catalog id sets `id:`,
 * a BYO path sets `path:` — an entry is `{ id | path }` and never both. When the
 * opposite key is the one present it is RENAMED, so the entry keeps its place
 * above `context:`; when both are (a manifest this CLI never writes) the
 * requested key wins and the other goes. An absent role block is created.
 * `opts.context` sets the llm's `context:`, which is only meaningful for llm.
 * Throws if there is no `model:` block.
 */
export function writeModelField(
  projectDir: string,
  role: Role,
  spec: ModelSpec,
  opts: { context?: number } = {},
): void {
  const yml = openHarnessYml(projectDir);
  if (!yml.has(['model'])) {
    throw new Error(`writeModelField: no \`model:\` block in ${harnessYmlPath(projectDir)}`);
  }

  const key = 'id' in spec ? 'id' : 'path';
  const other = key === 'id' ? 'path' : 'id';
  const value = 'id' in spec ? spec.id : spec.path;
  const entry = ['model', role];

  if (yml.has([...entry, other])) {
    if (yml.has([...entry, key])) yml.remove([...entry, other]);
    else yml.renameKey([...entry, other], key);
  }
  yml.set([...entry, key], value);

  if (role === 'llm' && opts.context != null) {
    yml.set(['model', 'llm', 'context'], opts.context);
  }
  yml.save();
}

/**
 * Rewrite the llm entry (+ optional `context`) in `<projectDir>/harness.yml` —
 * the scaffolder's llm-only convenience over {@link writeModelField}.
 */
export function applyModelChoice(projectDir: string, choice: ModelChoice): void {
  writeModelField(projectDir, 'llm', specFromValue(choice.llm), { context: choice.context });
}

/**
 * Read the active `model.<role>` pin from `<projectDir>/harness.yml` — the
 * inverse of {@link writeModelField}, used by `models:list`. Returns the `id:`
 * or `path:` under a LIVE `<role>:` block, or `null` when the role is unset.
 *
 * A commented-out block is unset, which falls out rather than being coded for:
 * a comment is not a node. Every valid spelling of a live one — `{ id: x }`,
 * `id: x`, `id: "x"` — reads the same.
 */
export function readModelField(projectDir: string, role: Role): ModelSpec | null {
  const yml = openHarnessYml(projectDir);
  const id = yml.get(['model', role, 'id']);
  if (typeof id === 'string') return { id };
  const path = yml.get(['model', role, 'path']);
  if (typeof path === 'string') return { path };
  return null;
}
