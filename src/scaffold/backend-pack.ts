/**
 * The CUDA backend pack, through the PROJECT's own `@lloyal-labs/lloyal.node`.
 *
 * The pack is one signed archive carrying every CUDA arch (Blackwell included — too large for an npm
 * package) and every CPU variant, cached once per box under `~/.cache/lloyal/backends/<version>-…/`
 * and keyed by the lloyal.node version that will load it. So the probe and the download are always
 * the project's addon's, resolved from its `node_modules`; this CLI carries no addon of its own.
 * The addon never fetches without being asked — this module is where the asking happens.
 */
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
