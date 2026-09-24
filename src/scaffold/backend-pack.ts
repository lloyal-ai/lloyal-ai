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
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { openHarnessYml, harnessYmlPath } from './harness-yml.js';

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
 * Write `gpu: cuda` into the live `llm:` block of `<projectDir>/harness.yml`: a live key is set in
 * place; otherwise the template's commented `# gpu: cuda` hint is PROMOTED to the real key, so the
 * file gains the setting without gaining a duplicate of its own guidance. Appends when there is no
 * hint. All YAML goes through `harness-yml`; nothing here knows the file is YAML.
 */
export function writeGpuField(projectDir: string, gpu: 'cuda'): void {
  const yml = openHarnessYml(projectDir);
  const where = harnessYmlPath(projectDir);
  if (!yml.has(['model'])) throw new Error(`writeGpuField: no \`model:\` block in ${where}`);
  // `model.llm`, not any `llm:` — and a COMMENTED block is not a node, so a
  // template whose llm is commented out refuses here rather than being written into.
  if (!yml.has(['model', 'llm'])) {
    throw new Error(`writeGpuField: no live \`model.llm:\` block in ${where}`);
  }

  // Already live → set it. Otherwise promote the template's `# gpu: cuda` hint,
  // or append when the manifest carries no hint to promote.
  if (!yml.setScalar(['model', 'llm', 'gpu'], gpu)) {
    yml.promote(['model', 'llm'], 'gpu', `gpu: ${gpu}`);
  }
  yml.save();
}

/** What `new` and `backends:install` did about the GPU, for the panel and the log. */
export type BackendOutcome =
  | { kind: 'pack'; dir: string }                    // pack installed, gpu: cuda written
  | { kind: 'npm' }                                  // the npm package serves this GPU natively, gpu: cuda written
  | { kind: 'cpu'; why: string; failed?: true };     // gpu left unset — chosen, unserved, or (failed) a download that broke

/** The project's addon and what its probe said, taken once: what the reader approved is what runs. */
export interface PackSnapshot { host: PackHost; probe: PackProbe }

/** Resolve the addon and probe once; a CPU outcome when the project cannot, or the probe cannot. */
export async function snapshotPack(root: string): Promise<PackSnapshot | { kind: 'cpu'; why: string }> {
  let host: PackHost | null;
  try {
    host = await projectPackHost(root);   // loading the project's addon can throw too (a native binding that will not load)
  } catch (err) {
    return { kind: 'cpu', why: `the project's lloyal.node could not be loaded — ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!host) return { kind: 'cpu', why: 'this project has no @lloyal-labs/lloyal.node that knows the backend pack — run `npm install` first' };
  try {
    return { host, probe: await host.probe() };
  } catch (err) {
    return { kind: 'cpu', why: `backend pack probe failed — ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * The one decision, shared by `new` and `backends:install`, over ONE snapshot: fetch the pack when it would
 * serve the GPU and the caller said yes; write `gpu: cuda` when that is then true. A download that breaks is
 * a CPU outcome marked failed, never a throw — the scaffold around it is already made and stays usable.
 */
export async function provisionCuda(
  root: string,
  snap: PackSnapshot,
  opts: { fetch: boolean; onProgress?: (got: number, total: number, file: string) => void },
): Promise<BackendOutcome> {
  const { host, probe } = snap;
  const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  // The key is the record of what runs; a harness.yml this writer cannot read (no live `llm:` block — a
  // hand-edited or third-party template) is said, not thrown: what was fetched stays fetched and usable.
  const wrote = (): string | null => {
    try { writeGpuField(root, 'cuda'); return null; }
    catch (err) { return `harness.yml could not be written (${msg(err)}) — add \`gpu: cuda\` under model.llm yourself`; }
  };
  if (probe.recommended && opts.fetch) {
    let dir: string;
    try {
      dir = await host.ensure({ includeRuntime: probe.needsRuntimeArchive, onProgress: opts.onProgress });
    } catch (err) {
      return { kind: 'cpu', why: `the pack download failed — ${msg(err)}; later: npx lloyal-ai backends:install`, failed: true };
    }
    const unwritten = wrote();
    return unwritten ? { kind: 'cpu', why: `the pack is installed → ${dir}, but ${unwritten}`, failed: true } : { kind: 'pack', dir };
  }
  if (cudaIsServed(probe, false)) {
    const unwritten = wrote();
    return unwritten ? { kind: 'cpu', why: unwritten, failed: true } : { kind: 'npm' };
  }
  return { kind: 'cpu', why: probe.recommended ? 'the pack was not installed; later: npx lloyal-ai backends:install' : (probe.reasons[probe.reasons.length - 1] ?? 'no CUDA backend serves this box') };
}

/** The offer as `new` and `backends:install` print it: the addon, the GPU, the probe's reasons, the download. */
export function describeSnapshot(snap: PackSnapshot): string {
  return `lloyal.node ${snap.host.version}${snap.probe.gpu ? ` · ${snap.probe.gpu.name}` : ''}\n${describeOffer(snap.probe).join('\n')}`;
}

