/**
 * The CUDA backend pack, through the PROJECT's own `@lloyal-labs/lloyal.node`.
 *
 * The pack is one signed archive carrying every CUDA arch (Blackwell included — too large for an npm
 * package) and every CPU variant, cached once per box under `~/.cache/lloyal/backends/<version>-…/`
 * and keyed by the lloyal.node version that will load it. So the probe and the download are always
 * the project's addon's, resolved from its `node_modules`; this CLI carries no addon of its own.
 * The addon never fetches without being asked — this module is where the asking happens.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** What the addon's probe reports — the fields this CLI reads, structurally. */
export interface PackProbe {
  gpu: { name: string } | null;
  recommended: boolean;
  needsRuntimeArchive: boolean;
  sizeBytes: number;
  runtimeSizeBytes: number;
  reasons: string[];
}

/** The project's addon, as far as the pack is concerned. */
export interface PackHost {
  version: string;
  probe(): Promise<PackProbe>;
  ensure(opts: { includeRuntime: boolean; onProgress?: (got: number, total: number, file: string) => void }): Promise<string>;
}

/** Only linux-x64 has a published pack; elsewhere there is nothing to ask about. */
export const packPlatform = (platform = process.platform, arch = process.arch): boolean =>
  platform === 'linux' && arch === 'x64';

/**
 * The project's `@lloyal-labs/lloyal.node`, or null when it is not installed or predates the pack
 * (no `probeBackendPack` export). Resolution starts at the project's own package.json, so a globally
 * run `npx lloyal-ai` still finds the project's copy — the one whose version keys the cache.
 */
export async function projectPackHost(root: string): Promise<PackHost | null> {
  const req = createRequire(join(root, 'package.json'));
  let entry: string;
  let version: string;
  try {
    entry = req.resolve('@lloyal-labs/lloyal.node');
    version = (req('@lloyal-labs/lloyal.node/package.json') as { version: string }).version;
  } catch {
    return null;
  }
  const mod = (await import(entry)) as {
    probeBackendPack?: () => Promise<PackProbe>;
    ensureBackendPack?: PackHost['ensure'];
  };
  if (typeof mod.probeBackendPack !== 'function' || typeof mod.ensureBackendPack !== 'function') return null;
  return { version, probe: mod.probeBackendPack, ensure: mod.ensureBackendPack };
}

const gb = (n: number): string => `${(n / 1e9).toFixed(1)} GB`;

/** The offer, in words: what the probe found and what saying yes downloads. */
export function describeOffer(probe: PackProbe): string[] {
  const lines = probe.reasons.map((r) => `  ${r}`);
  if (probe.recommended) {
    const runtime = probe.needsRuntimeArchive ? ` + CUDA runtime ${gb(probe.runtimeSizeBytes)}` : '';
    lines.push(`  download: backend pack ${gb(probe.sizeBytes)}${runtime}, once per box, verified against the platform key`);
  }
  return lines;
}

/** One line for the progress meter, in place. */
export function progressLine(write: (s: string) => void): (got: number, total: number, file: string) => void {
  return (got, total, file) => {
    write(`\rfetching ${file} — ${total > 0 ? Math.round((100 * got) / total) : 0}%   `);
  };
}

/** The NVIDIA GPU on this box, by name, or null — one `nvidia-smi` call; absent or failing means none. */
export function detectNvidiaGpu(run: (cmd: string, args: string[]) => { status: number | null; stdout: string } = defaultRun): string | null {
  if (!packPlatform()) return null;
  const q = run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']);
  const name = q.status === 0 ? q.stdout.trim().split('\n')[0]?.trim() : '';
  return name ? name : null;
}
const defaultRun = (cmd: string, args: string[]): { status: number | null; stdout: string } => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000 });
  return { status: r.status, stdout: r.stdout ?? '' };
};

/**
 * Whether `gpu: cuda` is a true statement for this box, from the probe alone: the pack is installed, or
 * the npm package serves the device natively (the probe says so of sm_86/89). Neither ⇒ the boot would
 * fail loud under the no-fallback rule, so the key stays unset and the boot says why.
 */
export function cudaIsServed(probe: PackProbe, packInstalled: boolean): boolean {
  return packInstalled || probe.reasons.some((r) => /served natively by the standard npm package/.test(r));
}

/**
 * Write `gpu: cuda` into the live `llm:` block of `<projectDir>/harness.yml`: a live `gpu:` line is
 * rewritten, the template's commented `# gpu: cuda` hint becomes the line, else one is inserted after
 * the model's `id:`/`path:`. The same light line edit `writeModelField` makes; no YAML parse.
 */
export function writeGpuField(projectDir: string, gpu: 'cuda'): void {
  const ymlPath = join(projectDir, 'harness.yml');
  const lines = readFileSync(ymlPath, 'utf8').split('\n');
  const llmIdx = lines.findIndex((l) => /^\s+llm:\s*$/.test(l));
  if (llmIdx === -1) throw new Error(`writeGpuField: no live \`llm:\` block in ${ymlPath}`);
  const indent = (lines[llmIdx].match(/^(\s+)/)?.[1] ?? '  ') + '  ';
  let end = llmIdx + 1;
  while (end < lines.length && (lines[end].trim() === '' || lines[end].startsWith(indent) || /^\s*#/.test(lines[end]) && lines[end].search(/\S/) >= indent.length)) end++;
  const live = lines.findIndex((l, i) => i > llmIdx && i < end && new RegExp(`^${indent}gpu:`).test(l));
  if (live !== -1) { lines[live] = `${indent}gpu: ${gpu}`; }
  else {
    const hint = lines.findIndex((l, i) => i > llmIdx && i < end && /^\s*#\s*gpu:/.test(l));
    if (hint !== -1) lines[hint] = `${indent}gpu: ${gpu}`;
    else {
      const anchor = lines.findIndex((l, i) => i > llmIdx && i < end && new RegExp(`^${indent}(?:id|path):`).test(l));
      lines.splice((anchor === -1 ? llmIdx : anchor) + 1, 0, `${indent}gpu: ${gpu}`);
    }
  }
  writeFileSync(ymlPath, lines.join('\n'));
}

/** What `new` and `backends:install` did about the GPU, for the panel and the log. */
export type BackendOutcome =
  | { kind: 'pack'; dir: string }          // pack installed, gpu: cuda written
  | { kind: 'npm' }                        // the npm package serves this GPU natively, gpu: cuda written
  | { kind: 'cpu'; why: string };          // gpu left unset — declined, offline, or unserved

/**
 * The one decision, shared by `new` and `backends:install`: probe through the project's addon; fetch the
 * pack when it would serve the GPU and the caller said yes; write `gpu: cuda` when that is then true.
 */
export async function provisionCuda(
  root: string,
  opts: { fetch: boolean; onProgress?: (got: number, total: number, file: string) => void; say?: (s: string) => void },
): Promise<BackendOutcome> {
  const say = opts.say ?? (() => {});
  const host = await projectPackHost(root);
  if (!host) return { kind: 'cpu', why: 'this project has no @lloyal-labs/lloyal.node that knows the backend pack — run `npm install` first' };
  let probe: PackProbe;
  try {
    probe = await host.probe();
  } catch (err) {
    return { kind: 'cpu', why: `backend pack probe failed — ${err instanceof Error ? err.message : String(err)}` };
  }
  say(`lloyal.node ${host.version}${probe.gpu ? ` · ${probe.gpu.name}` : ''}\n${describeOffer(probe).join('\n')}`);
  if (probe.recommended && opts.fetch) {
    const dir = await host.ensure({ includeRuntime: probe.needsRuntimeArchive, onProgress: opts.onProgress });
    writeGpuField(root, 'cuda');
    return { kind: 'pack', dir };
  }
  if (cudaIsServed(probe, false)) {
    writeGpuField(root, 'cuda');
    return { kind: 'npm' };
  }
  return { kind: 'cpu', why: probe.recommended ? 'the pack was not installed' : (probe.reasons[probe.reasons.length - 1] ?? 'no CUDA backend serves this box') };
}

