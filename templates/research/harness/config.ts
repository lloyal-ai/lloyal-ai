/**
 * The config layer — `harness.yml` (committed) + `harness.json` (local).
 *
 * Ported from reasoning.run's `src/tui-ink/config.ts` with one added rung:
 * this template's committed deployment manifest. Precedence at read time:
 *
 *   CLI flag > env var > harness.json (local, gitignored) > harness.yml > default
 *
 * `harness.yml` is what you commit — the deployment shape. `harness.json` is
 * what the running harness saves — your local overrides (`set_effort`,
 * `set_output_dir`, ability config). Writes are atomic (tmp-file + rename);
 * the first save in a git repo appends `harness.json` to `.gitignore` and
 * says so in the returned flag. Per-field provenance (`ConfigOrigin`) is
 * computed AS the layering runs — nothing here reports a source it didn't use.
 */
import { execFileSync } from "node:child_process";
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
  ConfigDefaults,
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
  defaults?: Partial<ConfigDefaults>;
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
  validateDefaults(yml.defaults);
  return yml;
}

/** Fail loud on a defaults value the pipeline can't run — a typo'd effort
 *  would otherwise crash mid-query instead of at boot. */
function validateDefaults(raw: Partial<ConfigDefaults> | undefined): void {
  if (!raw) return;
  if (
    raw.reasoningMode !== undefined &&
    raw.reasoningMode !== "flat" &&
    raw.reasoningMode !== "deep"
  ) {
    throw new Error(`defaults.reasoningMode must be flat or deep (got "${raw.reasoningMode}")`);
  }
  if (raw.effort !== undefined && !["low", "medium", "high", "ultra"].includes(raw.effort)) {
    throw new Error(`defaults.effort must be low, medium, high, or ultra (got "${raw.effort}")`);
  }
  if (raw.maxTurns !== undefined && (!Number.isInteger(raw.maxTurns) || raw.maxTurns < 1)) {
    throw new Error(`defaults.maxTurns must be a positive integer (got "${raw.maxTurns}")`);
  }
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

const SHIPPED_DEFAULTS: ConfigDefaults = {
  reasoningMode: "flat",
  effort: "high",
  maxTurns: 10,
};

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
  // Same treatment for hand-edited defaults: the committed yml fails LOUD at
  // load (a deliberate deploy deserves a loud typo), but the local overlay is
  // machine-written — an invalid hand edit falls through to the next rung
  // instead of reaching the preset lookup mid-query.
  const ld = local?.defaults;
  const localReasoningMode =
    ld?.reasoningMode === "flat" || ld?.reasoningMode === "deep" ? ld.reasoningMode : undefined;
  const localEffort =
    ld?.effort !== undefined && ["low", "medium", "high", "ultra"].includes(ld.effort)
      ? ld.effort
      : undefined;
  const localMaxTurns =
    Number.isInteger(ld?.maxTurns) && (ld!.maxTurns as number) >= 1 ? ld!.maxTurns : undefined;

  // "" is a CLEAR wherever a path is stored — normalize to absent BEFORE both
  // selection and provenance, so an empty override can never claim a rung.
  const str = (v: string | undefined): string | undefined => (v ? v : undefined);
  const cliOutputDir = str(cli.outputDir);
  const localOutputDir = str(local?.sources?.outputDir);
  const ymlOutputDir = str(yml.sources?.outputDir);
  const cliModelPath = str(cli.modelPath);
  const localModelPath = str(local?.model?.path);
  const ymlModelPath = str(llm.path);
  const cliReranker = str(cli.reranker);
  const localReranker = str(local?.model?.reranker);
  const ymlReranker = str(yml.model?.reranker?.path);

  // Path-shaped fields resolve through resolvePath at this boundary (~ expansion
  // + relative→absolute; idempotent on absolute paths), so stale `~`-bearing
  // values in a hand-edited file still work downstream.
  const rawOutputDir = cliOutputDir ?? localOutputDir ?? ymlOutputDir;
  const outputDir = rawOutputDir ? resolvePath(rawOutputDir) : undefined;
  const rawModelPath = cliModelPath ?? localModelPath ?? ymlModelPath;
  const modelPath = rawModelPath ? resolvePath(rawModelPath) : undefined;
  const rawReranker = cliReranker ?? localReranker ?? ymlReranker;
  const reranker = rawReranker ? resolvePath(rawReranker) : undefined;
  // Same resilient-overlay family as gpu/defaults: a hand-edited non-integer
  // nCtx (null, a string) falls through instead of reaching createContext.
  const localNCtx = Number.isInteger(local?.model?.nCtx) ? local?.model?.nCtx : undefined;
  const nCtx = cli.nCtx ?? envNCtx ?? localNCtx ?? llm.context;
  const gpu = cli.gpu ?? envGpu ?? localGpu ?? llm.gpu;
  const reasoningMode =
    cli.reasoningMode ??
    localReasoningMode ??
    yml.defaults?.reasoningMode ??
    SHIPPED_DEFAULTS.reasoningMode;

  const defaults: ConfigDefaults = {
    reasoningMode,
    effort: localEffort ?? yml.defaults?.effort ?? SHIPPED_DEFAULTS.effort,
    maxTurns: localMaxTurns ?? yml.defaults?.maxTurns ?? SHIPPED_DEFAULTS.maxTurns,
  };

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
    defaults,
    model: {
      path: modelPath,
      reranker,
      nCtx,
      gpu,
      branches: local?.model?.branches ?? llm.branches,
      kvCache: local?.model?.kvCache ?? llm.kvCache,
      backendPack: local?.model?.backendPack === false ? false : undefined,
    },
  };

  // Provenance falls out of the same layering that picked each value.
  const rung = <T>(
    c: T | undefined,
    e: T | undefined,
    l: T | undefined,
    y: T | undefined,
  ): ConfigOrigin[keyof ConfigOrigin] =>
    // `!= null` mirrors `??`: a hand-edited null is a clear on every rung,
    // and provenance must agree with the selection by construction.
    c != null ? "cli" : e != null ? "env" : l != null ? "file" : y != null ? "yml" : "default";

  const origin: ConfigOrigin = {
    reasoningMode: rung(cli.reasoningMode, undefined, localReasoningMode, yml.defaults?.reasoningMode),
    modelPath: rung(cliModelPath, undefined, localModelPath, ymlModelPath ?? str(llm.id)),
    reranker: rung(cliReranker, undefined, localReranker, ymlReranker ?? str(yml.model?.reranker?.id)),
    nCtx: rung(cli.nCtx, envNCtx, localNCtx, llm.context),
    gpu: rung(cli.gpu, envGpu, localGpu, llm.gpu),
    outputDir: rung(cliOutputDir, undefined, localOutputDir, ymlOutputDir),
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

/** Read harness.json for the WRITER. Unlike the loader — which treats an
 *  unreadable or future-versioned file as an ignorable overlay — a save must
 *  never rebuild over content it cannot understand: that would destroy a
 *  newer runtime's settings. Absent file ⇒ null (a fresh write is safe);
 *  anything else it can't use ⇒ throw, leaving the file untouched (the
 *  harness surfaces the message as an error toast). */
function readJsonForWrite(p: string): Partial<Config> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    // ONLY a missing file is a fresh config. Any other read failure (EACCES,
    // EIO) means a file EXISTS that we cannot see — replacing it blind would
    // destroy settings the promise above says we leave untouched.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `${JSON_NAME} exists but cannot be read (${(err as NodeJS.ErrnoException).code ?? "unknown"}) — nothing was saved.`,
    );
  }
  let parsed: Partial<Config> & { version?: number };
  try {
    parsed = JSON.parse(raw) as Partial<Config> & { version?: number };
  } catch {
    throw new Error(`${JSON_NAME} is not valid JSON — fix or delete it; nothing was saved.`);
  }
  if (parsed.version !== 1) {
    throw new Error(
      `${JSON_NAME} is version ${String(parsed.version)}; this harness writes version 1 — not overwriting a newer runtime's settings.`,
    );
  }
  return parsed;
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
  const current = readJsonForWrite(resolvedPath);

  const nextSources: ConfigSources = {
    ...(current?.sources ?? {}),
    ...(patch.sources ?? {}),
  };
  if (patch.sources?.outputDir === "") delete nextSources.outputDir;

  const nextModel = { ...(current?.model ?? {}), ...(patch.model ?? {}) };
  // Same clear rule as outputDir: an empty path deletes the key.
  if (nextModel.path === "") delete nextModel.path;
  if (nextModel.reranker === "") delete nextModel.reranker;

  const nextApps: ConfigApps = { ...(current?.abilities ?? {}) };
  for (const [name, cfg] of Object.entries(patch.abilities ?? {})) {
    nextApps[name] = { ...cfg };
  }

  const next: ConfigPatch & { version: 1 } = {
    version: 1,
    sources: nextSources,
    abilities: nextApps,
    defaults:
      current?.defaults || patch.defaults
        ? { ...(current?.defaults ?? {}), ...(patch.defaults ?? {}) }
        : undefined,
    model: current?.model || patch.model ? nextModel : undefined,
  };

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const tmp = resolvedPath + ".tmp-" + process.pid;
  // 0600: ability config can carry credentials (e.g. an API key), so the file
  // must never be group/world-readable — and because rename preserves the tmp
  // file's mode, every save also TIGHTENS a previously looser file.
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, resolvedPath);

  const gitignored = maybeAppendGitignore(resolvedPath);
  return { path: resolvedPath, gitignored, skipped: [] };
}

/** If CWD (or an ancestor) is a git repo, append `harness.json` to the nearest
 *  `.gitignore` iff Git doesn't already ignore it. `git check-ignore` is the
 *  authority (it honors wildcards, anchored patterns, and global excludes);
 *  when git isn't runnable, a literal line-match is the conservative fallback.
 *  Returns true only when a write happened — at most once per repo (scaffolds
 *  ship it pre-listed). */
function maybeAppendGitignore(configFilePath: string): boolean {
  try {
    const repoRoot = findGitRoot(path.dirname(configFilePath));
    if (!repoRoot) return false;
    const gitignorePath = path.join(repoRoot, ".gitignore");
    const relative = path.relative(repoRoot, configFilePath).replace(/\\/g, "/");
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, "utf8")
      : "";
    let ignored: boolean | null = null;
    try {
      execFileSync("git", ["check-ignore", "-q", "--", relative], {
        cwd: repoRoot,
        stdio: "ignore",
      });
      ignored = true;
    } catch (e) {
      // exit 1 = definitively not ignored; anything else (git missing,
      // not-a-repo edge) = unknown → fall back to the literal check.
      ignored = (e as { status?: number }).status === 1 ? false : null;
    }
    if (ignored === true) return false;
    if (ignored === null) {
      const name = path.basename(configFilePath);
      const needle = new RegExp(
        `(^|\\n)\\s*(${escapeRe(relative)}|${escapeRe(name)})\\s*(\\n|$)`,
      );
      if (needle.test(existing)) return false;
    }
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
