/**
 * The config LAYERING — this harness's config surface definition.
 *
 * Precedence at read time:
 *
 *   CLI flag > env var > harness.json (local, gitignored) > harness.yml > default
 *
 * `harness.yml` is what you commit — the deployment shape. `harness.json` is
 * what the running harness saves — your local overrides. This file says WHICH
 * keys exist and which env var / yml path feeds each one; add your own knob by
 * extending `Config` (config-types.ts), `HarnessYml` below, and its rung line
 * in `loadConfig`. The MECHANICS — atomic 0600 writes, the version guard,
 * `.gitignore` upkeep, `~` expansion — come from `@lloyal-labs/rig/node` and
 * are not yours to maintain. Per-field provenance (`ConfigOrigin`) is computed
 * AS the layering runs — nothing here reports a source it didn't use.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { parse } from "yaml";
import { rung } from "@lloyal-labs/rig";
import {
  resolvePath,
  resolveAppConfigPaths,
  readJsonOverlay,
  readJsonForWrite,
  writeJsonAtomic,
  maybeAppendGitignore,
} from "@lloyal-labs/rig/node";
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

/** Patch-path → origin key: which `ConfigOrigin` field each patched config
 *  path reports under. Drives the `session` marks on in-memory (served)
 *  patches — extend it alongside `ConfigOrigin` when you add a knob. */
export const SESSION_ORIGIN_MAP: Record<string, keyof ConfigOrigin & string> = {
  "sources.outputDir": "outputDir",
  "model.path": "modelPath",
  "model.reranker": "reranker",
  "model.nCtx": "nCtx",
  "model.gpu": "gpu",
};

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
  /** Committed per-ability config — the operator's deploy declaration (e.g. a
   *  corpus path). Secrets belong in env at the ability factory, never here. */
  abilities?: ConfigApps;
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

// ── Load: layer the rungs, computing provenance as we go ────────────

export function loadConfig(
  yml: HarnessYml,
  cli: CliOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): LoadedConfig {
  const resolvedPath = path.resolve(cwd, JSON_NAME);
  const local = readJsonOverlay<Config>(resolvedPath);
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
  // Same resilient-overlay family as gpu: a hand-edited non-integer nCtx
  // (null, a string) falls through instead of reaching createContext.
  const localNCtx = Number.isInteger(local?.model?.nCtx) ? local?.model?.nCtx : undefined;
  const nCtx = cli.nCtx ?? envNCtx ?? localNCtx ?? llm.context;
  const gpu = cli.gpu ?? envGpu ?? localGpu ?? llm.gpu;

  // Ability config layers like everything else: the local overlay WHOLE-
  // REPLACES a named ability's committed yml entry (matching the store's
  // whole-replace convention — no per-key merge across rungs). Path-shaped
  // values resolve generically, matching the harness-level fields. Secrets
  // belong in env at the ability factory, never in the committed yml.
  const abilities: ConfigApps = {};
  for (const [name, cfg] of Object.entries(yml.abilities ?? {})) {
    abilities[name] = resolveAppConfigPaths(cfg);
  }
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

  // Provenance falls out of the same layering that picked each value —
  // `rung` mirrors `??` by construction (@lloyal-labs/rig).
  const origin: ConfigOrigin = {
    modelPath: rung(cliModelPath, undefined, localModelPath, ymlModelPath ?? str(llm.id)),
    reranker: rung(cliReranker, undefined, localReranker, ymlReranker ?? str(yml.model?.reranker?.id)),
    nCtx: rung(cli.nCtx, envNCtx, localNCtx, llm.context),
    gpu: rung(cli.gpu, envGpu, localGpu, llm.gpu),
    outputDir: rung(cliOutputDir, undefined, localOutputDir, ymlOutputDir),
  };

  return { config, origin, path: resolvedPath, loadedFromFile: !!local };
}

// ── Save: this template's read-modify-write over rig's disk mechanics ─

/** Write a patch into `harness.json` (atomic 0600 tmp+rename via rig).
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
  const resolvedPath = path.resolve(cwd, JSON_NAME);
  // The WRITER's read: a file it cannot understand throws (never rebuild over
  // a newer runtime's settings); only a missing file is a fresh config.
  const current = readJsonForWrite<Config>(resolvedPath, JSON_NAME);

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

  const next = {
    version: 1,
    sources: nextSources,
    abilities: nextApps,
    model: current?.model || patch.model ? nextModel : undefined,
  };

  writeJsonAtomic(resolvedPath, next);
  const gitignored = maybeAppendGitignore(resolvedPath);
  return { path: resolvedPath, gitignored, skipped: [] };
}
