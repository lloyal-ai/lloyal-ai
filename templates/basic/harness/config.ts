/**
 * The config layer — `harness.yml` (committed) + `harness.json` (local).
 *
 * Ported from reasoning.run's `src/tui-ink/config.ts` with one added rung:
 * this template's committed deployment manifest. Precedence at read time:
 *
 *   CLI flag > env var > harness.json (local, gitignored) > harness.yml > default
 *
 * `harness.yml` is what you commit — the deployment shape. `harness.json` is
 * what the running harness saves — your local overrides. Writes are atomic (tmp-file + rename);
 * the first save in a git repo appends `harness.json` to `.gitignore` and
 * says so in the returned flag. Per-field provenance (`ConfigOrigin`) is
 * computed AS the layering runs — nothing here reports a source it didn't use.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import { resolvePath } from "./path-utils.js";
import { isConfigGpu } from "./config-types.js";
import type {
  CliOverrides,
  Config,
  ConfigPatch,
  ConfigApps,
  ConfigGpu,
  ConfigKvCache,
  ConfigOrigin,
  ConfigSources,
  LoadedConfig,
  SaveResult,
} from "./config-types.js";

const JSON_NAME = "harness.json";
const YML_NAME = "harness.yml";

// ── harness.yml (the committed rung) ────────────────────────────────

export interface ModelEntry {
  id?: string;
  path?: string;
  context?: number;
  /** Concurrent sequences (`nSeqMax`). Each one holds its own KV lease, and on
   *  a hybrid/linear-attention model its own recurrent state — which is f32 and
   *  not affected by `kvCache`. Lower this if the machine is memory-bound. */
  branches?: number;
  /** KV cache type for the attention layers. Bounds the smallest meaningful
   *  score difference; raise it for precision, lower it for memory. */
  kvCache?: ConfigKvCache;
  /** GPU backend variant. A configured value is a deliberate deploy choice —
   *  the boot fails loud if the variant is unavailable, never silently CPU. */
  gpu?: ConfigGpu;
}

export interface HarnessYml {
  model?: { llm?: ModelEntry; reranker?: ModelEntry };
  sources?: { outputDir?: string };
}

/** Read + validate `harness.yml`. Throws with a one-line message on a missing
 *  or invalid file — the boot catches, prints, and exits: a bad manifest must
 *  fail BEFORE any model fetch. */
export function loadYml(cwd: string = process.cwd()): HarnessYml {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(cwd, YML_NAME), "utf8");
  } catch {
    throw new Error(`${YML_NAME} not found — run from your harness project root.`);
  }
  let yml: HarnessYml;
  try {
    yml = (parse(raw) ?? {}) as HarnessYml;
  } catch (err) {
    throw new Error(
      `${YML_NAME} is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const gpu = yml.model?.llm?.gpu;
  if (gpu !== undefined && !isConfigGpu(gpu)) {
    throw new Error(`${YML_NAME}: model.llm.gpu must be default, cuda, or vulkan (got "${gpu}")`);
  }
  return yml;
}

// ── harness.json (the local rung) ───────────────────────────────────

function jsonPath(cwd: string): string {
  return path.resolve(cwd, JSON_NAME);
}

/** Read `harness.json` if present and version-compatible; null otherwise.
 *  A malformed or future-versioned file is ignored, never fatal — the local
 *  rung is an overlay, and the layers beneath it still describe a runnable
 *  harness. */
function readJsonIfExists(p: string): Partial<Config> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<Config> & {
      version?: number;
    };
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Load: layer the rungs, computing provenance as we go ────────────

export function loadConfig(
  yml: HarnessYml,
  cli: CliOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): LoadedConfig {
  const resolvedPath = jsonPath(cwd);
  const local = readJsonIfExists(resolvedPath);
  const llm = yml.model?.llm ?? {};

  // env rungs. Invalid values fall through to the next rung rather than
  // erroring — these vars predate the config layer.
  const envNCtxStr = env.LLAMA_CTX_SIZE?.trim();
  const envNCtx =
    envNCtxStr && /^\d+$/.test(envNCtxStr) ? parseInt(envNCtxStr, 10) : undefined;
  const envGpuStr = env.LLOYAL_GPU?.trim();
  const envGpu = isConfigGpu(envGpuStr) ? envGpuStr : undefined;
  // A hand-edited harness.json could carry a bad gpu value; ignore, don't error.
  const localGpu = isConfigGpu(local?.model?.gpu) ? local?.model?.gpu : undefined;

  // Path-shaped fields resolve through resolvePath at this boundary (~ expansion
  // + relative→absolute; idempotent on absolute paths), so stale `~`-bearing
  // values in a hand-edited file still work downstream.
  const rawOutputDir = cli.outputDir ?? local?.sources?.outputDir ?? yml.sources?.outputDir;
  const outputDir = rawOutputDir ? resolvePath(rawOutputDir) : undefined;
  const rawModelPath = cli.modelPath ?? local?.model?.path ?? llm.path;
  const modelPath = rawModelPath ? resolvePath(rawModelPath) : undefined;
  const reranker = cli.reranker ?? local?.model?.reranker ?? yml.model?.reranker?.path;
  const nCtx = cli.nCtx ?? envNCtx ?? local?.model?.nCtx ?? llm.context;
  const gpu = cli.gpu ?? envGpu ?? localGpu ?? llm.gpu;

  // Ability config is json-only (there is no yml rung for it); path-shaped
  // values resolve generically, matching the harness-level fields.
  const abilities: ConfigApps = {};
  for (const [name, cfg] of Object.entries(local?.abilities ?? {})) {
    abilities[name] = resolveAppConfigPaths(cfg);
  }

  const sources: ConfigSources = {};
  if (outputDir) sources.outputDir = outputDir;

  const config: Config = {
    version: 1,
    sources,
    abilities,
    model: {
      path: modelPath,
      reranker,
      nCtx,
      gpu,
      branches: local?.model?.branches ?? llm.branches,
      kvCache: local?.model?.kvCache ?? llm.kvCache,
    },
  };

  // Provenance falls out of the same layering that picked each value.
  const rung = <T>(
    c: T | undefined,
    e: T | undefined,
    l: T | undefined,
    y: T | undefined,
  ): ConfigOrigin[keyof ConfigOrigin] =>
    c !== undefined ? "cli" : e !== undefined ? "env" : l !== undefined ? "file" : y !== undefined ? "yml" : "default";

  const origin: ConfigOrigin = {
    modelPath: rung(cli.modelPath, undefined, local?.model?.path, llm.path ?? llm.id),
    reranker: rung(cli.reranker, undefined, local?.model?.reranker, yml.model?.reranker?.path ?? yml.model?.reranker?.id),
    nCtx: rung(cli.nCtx, envNCtx, local?.model?.nCtx, llm.context),
    gpu: rung(cli.gpu, envGpu, localGpu, llm.gpu),
    outputDir: rung(cli.outputDir, undefined, local?.sources?.outputDir, yml.sources?.outputDir),
  };

  return { config, origin, path: resolvedPath, loadedFromFile: !!local };
}

/** Resolve path-shaped string values in one ability's config object, with no
 *  per-ability name knowledge: a value is a path when its property name ends
 *  in "Path" (case-insensitive) or the string starts with `~`, `/`, or `.`. */
function resolveAppConfigPaths(
  cfg: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cfg)) {
    if (
      typeof value === "string" &&
      value !== "" &&
      (/path$/i.test(key) || /^[~/.]/.test(value))
    ) {
      out[key] = resolvePath(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ── Save: atomic write + one-time .gitignore append ─────────────────

/** Write a patch into `harness.json` atomically (tmp-file + rename).
 *
 *  Ability config (`patch.abilities`) is read-modify-written: each named
 *  ability WHOLE-REPLACES its config object, other abilities untouched; an
 *  empty object is a valid "no config" replace. `sources.outputDir === ""`
 *  clears the key rather than persisting ''. `skipped` is reserved (env
 *  fallbacks live in the owning ability's factory, not this layer). */
export function saveLocalConfig(
  patch: ConfigPatch,
  cwd: string = process.cwd(),
): SaveResult {
  const resolvedPath = jsonPath(cwd);
  const current = readJsonIfExists(resolvedPath);

  const nextSources: ConfigSources = {
    ...(current?.sources ?? {}),
    ...(patch.sources ?? {}),
  };
  if (patch.sources?.outputDir === "") delete nextSources.outputDir;

  const nextApps: ConfigApps = { ...(current?.abilities ?? {}) };
  for (const [name, cfg] of Object.entries(patch.abilities ?? {})) {
    nextApps[name] = { ...cfg };
  }

  const next: ConfigPatch & { version: 1 } = {
    version: 1,
    sources: nextSources,
    abilities: nextApps,
    model:
      current?.model || patch.model
        ? { ...(current?.model ?? {}), ...(patch.model ?? {}) }
        : undefined,
  };

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tmp = resolvedPath + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, resolvedPath);

  const gitignored = maybeAppendGitignore(resolvedPath);
  return { path: resolvedPath, gitignored, skipped: [] };
}

/** If CWD (or an ancestor) is a git repo, append `harness.json` to the nearest
 *  `.gitignore` iff it isn't already listed. Returns true only when a write
 *  happened — at most once per repo (scaffolds ship it pre-listed). */
function maybeAppendGitignore(configFilePath: string): boolean {
  try {
    const repoRoot = findGitRoot(path.dirname(configFilePath));
    if (!repoRoot) return false;
    const gitignorePath = path.join(repoRoot, ".gitignore");
    const relative = path.relative(repoRoot, configFilePath).replace(/\\/g, "/");
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, "utf8")
      : "";
    const name = path.basename(configFilePath);
    const needle = new RegExp(
      `(^|\\n)\\s*(${escapeRe(relative)}|${escapeRe(name)})\\s*(\\n|$)`,
    );
    if (needle.test(existing)) return false;
    const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(gitignorePath, prefix + relative + "\n");
    return true;
  } catch {
    return false;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findGitRoot(start: string): string | null {
  let cur = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}
