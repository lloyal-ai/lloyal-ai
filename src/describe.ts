/**
 * Publish-time "attention surface" extraction.
 *
 * At `lloyal publish` (a TRUSTED publisher-machine context) we serialize
 * everything the ability injects into the model's context — the per-spawn skill
 * prose, every tool's name + description + parameter schema, `useWhen`, and the
 * config schema — into `attention-surface.json`, which the publish command
 * writes INTO the npm tarball. Because the worker signs the tarball bytes at
 * approval, this artifact is covered by the same Ed25519 signature: a reviewer
 * and `lloyal install` can verify exactly what enters the model WITHOUT
 * executing untrusted code.
 *
 * Tool descriptions + parameter schemas live in compiled `Tool` instances, so
 * the only way to read them is to CONSTRUCT the ability. We do that in an ISOLATED
 * subprocess (`node -e`, cwd = the ability dir so its own deps resolve) under a
 * describe harness that seeds mock Effection contexts — never in the CLI's own
 * process. This keeps the consumer-facing CLI dependency-free, sandboxes
 * arbitrary construction code behind a 30s timeout, and degrades LOUDLY to
 * ability.json tool NAMES if construction throws / times out / the ability is ESM-only.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface AttentionSurfaceTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's args, or null if absent. */
  parameters: unknown | null;
  protected: boolean;
}

export interface AttentionSurface {
  /** Forward-compat seam (number, not a literal) so install tolerates bumps. */
  schemaVersion: number;
  protocol: { name: string; useWhen: string; tools: string[] };
  /** Raw skill.eta template — the per-spawn system prompt. NEVER pre-rendered. */
  skill: string;
  configSchema?: unknown;
  tools: AttentionSurfaceTool[];
  /** True when tool descriptions/params could not be extracted (names only). */
  degraded?: boolean;
}

export interface DescribeAbilityJson {
  name: string;
  appProtocolVersion?: string;
  protocol?: { name?: string; useWhen?: string; tools?: string[] };
  configSchema?: { required?: unknown } & Record<string, unknown>;
}

export interface DescribePackageJson {
  name: string;
  version: string;
  main?: string;
}

const DESCRIBE_TIMEOUT_MS = 30_000;

/**
 * The describe subprocess body. Runs in the ABILITY's directory so `require`
 * resolves the ability's own `effection` + `@lloyal-labs/lloyal-agents`. Reads the
 * entry path + required-config keys from env (robust vs `-e` argv quirks).
 */
const DESCRIBE_SCRIPT = `(async () => {
  const path = require('node:path');
  const os = require('node:os');
  const fs = require('node:fs');
  const tmpDirs = [];
  try {
    const entry = process.env.HARNESS_DESCRIBE_ENTRY;
    const required = JSON.parse(process.env.HARNESS_DESCRIBE_REQUIRED || '[]');
    const { run } = require('effection');
    // Resolved from the ABILITY's own installed runtime, whose version we do not
    // control — so accept every spelling a shipped runtime has had. The ability
    // contract and the services moved from lloyal-agents to rig; before that the
    // config store context was AppConfigStoreCtx and the reranker rode its own
    // RerankerCtx. A bare destructure of a name the installed version does not
    // export yields undefined and throws on .set() below, degrading this to
    // names-only with a stack trace as the only clue. Every spelling, permanently.
    const agents = require('@lloyal-labs/lloyal-agents');
    let rig = {};
    try { rig = require('@lloyal-labs/rig'); } catch {}
    // Every DISTINCT spelling is set, not the first found: an ability built against one runtime may sit beside
    // a newer rig hoisted next to it, and it reads the context of the spelling IT imports.
    const ConfigStoreCtxs = [...new Set([rig.AbilityConfigStoreCtx, agents.AbilityConfigStoreCtx, agents.AppConfigStoreCtx].filter(Boolean))];
    if (ConfigStoreCtxs.length === 0) throw new Error('neither @lloyal-labs/rig nor @lloyal-labs/lloyal-agents exports AbilityConfigStoreCtx');
    const Services = rig.Services;
    const RerankerCtx = agents.RerankerCtx;
    const mod = require(entry);
    const key = Object.keys(mod).find((k) => /^create[A-Za-z0-9]*(Ability|App)$/.test(k) && typeof mod[k] === 'function');
    if (!key) throw new Error('no create*Ability factory export in ' + entry);
    const factory = mod[key];
    const synth = {};
    for (const k of required) {
      if (/path|dir|file|root/i.test(k)) {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-describe-'));
        tmpDirs.push(d);
        // Seed a placeholder doc so resource-loading factories (e.g. corpus)
        // construct over a NON-empty dir instead of throwing "no files matched".
        try { fs.writeFileSync(path.join(d, '_describe.md'), '# describe placeholder'); } catch {}
        synth[k] = d;
      } else {
        synth[k] = 'describe-placeholder';
      }
    }
    // A stand-in for EVERY service the platform provides, whatever this ability declares: only construction
    // needs them to exist (corpus tokenizes its chunks at build; nothing scores, sees or embeds until a run),
    // and an ability that reads a service its manifest declares must find one here or describe degrades to
    // names-only for a reason that is not the ability's.
    const reranker = {
      tokenize: async () => [],
      tokenizeChunks: async () => {},
      scoreBatch: async (_q, texts) => texts.map(() => 0),
      score: async function* () {},
      dispose: () => {},
    };
    const embedding = {
      dimension: 2,
      *embed(texts) { return texts.map(() => new Float32Array(2)); },
      *tokenize() { return []; },
      dispose: () => {},
    };
    const vision = { artifact: 'describe-placeholder' };
    const cfgStore = { *get() { return synth; }, *set() {}, *clear() {} };
    const ability = await run(function* () {
      if (Services) yield* Services.set({ reranker, vision, embedding });
      if (RerankerCtx) yield* RerankerCtx.set(reranker);
      for (const Ctx of ConfigStoreCtxs) yield* Ctx.set(cfgStore);
      return yield* factory();
    });
    const tools = (ability.tools || []).map((t) => ({
      name: String(t.name),
      description: typeof t.description === 'string' ? t.description : '',
      parameters: t.parameters == null ? null : t.parameters,
      protected: t.protected === true,
    }));
    process.stdout.write(JSON.stringify({ tools }));
  } catch (e) {
    process.stderr.write(String((e && e.stack) || e));
    process.exitCode = 3;
  } finally {
    // Reap the synthetic config dirs created above — else every describe run
    // (publish, tests) leaks a harness-describe-* dir per path-like config key.
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
  }
  // Do NOT call process.exit() here. The parent reads stdout as a PIPE, so the
  // write is async — process.exit() can terminate before a large JSON payload
  // finishes flushing, truncating it so the parent mis-reads a successful
  // describe as "unparseable output" and degrades to names-only. Let Node exit
  // naturally once the event loop drains (stdout/stderr flush first);
  // process.exitCode (set to 3 on failure above) is honored. A genuine hang is
  // bounded by the parent spawn's \`timeout\`.
})();`;

function requiredConfigKeys(configSchema: DescribeAbilityJson['configSchema']): string[] {
  const req = configSchema?.required;
  return Array.isArray(req) ? req.filter((k): k is string => typeof k === 'string') : [];
}

function coerceTool(t: unknown): AttentionSurfaceTool | null {
  if (typeof t !== 'object' || t === null) return null;
  const o = t as Record<string, unknown>;
  if (typeof o.name !== 'string' || o.name.length === 0) return null;
  return {
    name: o.name,
    description: typeof o.description === 'string' ? o.description : '',
    parameters: o.parameters ?? null,
    protected: o.protected === true,
  };
}

/**
 * Construct the ability in an isolated subprocess and read its tool schemas.
 * Returns null on ANY failure (logged) so the caller falls back to names.
 */
function describeTools(
  abilityDir: string,
  mainRel: string,
  required: string[],
  abilityName: string,
): Promise<AttentionSurfaceTool[] | null> {
  return new Promise((resolvePromise) => {
    const entry = resolve(abilityDir, mainRel);
    // Strip NODE_OPTIONS so a parent-process loader (e.g. a test runner's, or a
    // publisher's wrapper) isn't inherited by the bare `node -e` describe child.
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HARNESS_DESCRIBE_ENTRY: entry,
      HARNESS_DESCRIBE_REQUIRED: JSON.stringify(required),
    };
    delete childEnv.NODE_OPTIONS;
    const proc = spawn(process.execPath, ['-e', DESCRIBE_SCRIPT], {
      cwd: abilityDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: DESCRIBE_TIMEOUT_MS,
      env: childEnv,
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (c: Buffer) => (out += c.toString('utf-8')));
    proc.stderr.on('data', (c: Buffer) => (err += c.toString('utf-8')));
    const fallback = (why: string) => {
      process.stderr.write(
        `lloyal publish: WARNING — could not construct "${abilityName}" to read tool ` +
          `descriptions/parameters (${why.trim().split('\n')[0] || 'unknown'}). ` +
          `Falling back to tool NAMES only from ability.json. The attention surface for ` +
          `this version will omit tool descriptions + parameter schemas.\n`,
      );
      resolvePromise(null);
    };
    proc.on('error', (e) => fallback(String((e as Error).message)));
    proc.on('close', (code, signal) => {
      // A signal kill (e.g. the `timeout` option firing SIGTERM) reports
      // code===null + a non-null signal; surface the signal so a timeout reads
      // as a kill, not the unhelpful "describe exited null".
      if (code !== 0)
        return fallback(err || (signal ? `describe killed by ${signal}` : `describe exited ${code}`));
      try {
        const parsed = JSON.parse(out) as { tools?: unknown };
        const tools = Array.isArray(parsed.tools)
          ? parsed.tools.map(coerceTool).filter((t): t is AttentionSurfaceTool => t !== null)
          : [];
        resolvePromise(tools);
      } catch {
        fallback('describe produced unparseable output');
      }
    });
  });
}

/**
 * Build the full attention surface for an ability. `protocol` + `configSchema` come
 * from ability.json; `skill` is the raw skill.eta file; tool schemas come from the
 * describe subprocess (with a names-only fallback).
 */
export async function buildAttentionSurface(
  abilityDir: string,
  abilityJson: DescribeAbilityJson,
  packageJson: DescribePackageJson,
): Promise<AttentionSurface> {
  const protocol = {
    name: abilityJson.protocol?.name ?? abilityJson.name,
    useWhen: abilityJson.protocol?.useWhen ?? '',
    tools: Array.isArray(abilityJson.protocol?.tools)
      ? abilityJson.protocol!.tools!.filter((t): t is string => typeof t === 'string')
      : [],
  };

  let skill = '';
  try {
    skill = await readFile(join(abilityDir, 'skill.eta'), 'utf-8');
  } catch {
    // Abilities without a skill.eta are valid (rare) — leave skill empty.
  }

  const described = await describeTools(
    abilityDir,
    packageJson.main ?? 'dist/index.js',
    requiredConfigKeys(abilityJson.configSchema),
    abilityJson.name,
  );

  const degraded = described === null;
  const tools: AttentionSurfaceTool[] = described ?? protocol.tools.map((name) => ({
    name,
    description: '',
    parameters: null,
    protected: false,
  }));

  const surface: AttentionSurface = { schemaVersion: 1, protocol, skill, tools };
  if (abilityJson.configSchema !== undefined) surface.configSchema = abilityJson.configSchema;
  if (degraded) surface.degraded = true;
  return surface;
}
