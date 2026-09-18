/**
 * Probe results as `@lloyal-labs/lloyal.node`'s `probeBackendPack` actually returns them — the GPU rows and
 * every `reasons` line are verbatim from lloyal-node `test/backend-pack-unit.ts` (its fake nvidia-smi /
 * ldconfig fixtures and manifest: toolkit 12.9, archive 800 MB, runtime 250 MB) and `src/backend-pack.ts`'s
 * format strings. Product names are what `nvidia-smi --query-gpu=name` prints (B200 confirmed on the
 * 2026-07-08 pod). If the probe's wording moves, `cudaIsServed` and these rows move with it — together.
 */
import type { PackProbe } from '../src/scaffold/backend-pack.js';

/** `NVIDIA B200, 10.0, 580.65` · banner CUDA 13.0 · cudart 12.2.140 on disk: native SASS, runtime too old. */
export const B200: PackProbe = {
  gpu: { name: 'NVIDIA B200' },
  recommended: true,
  needsRuntimeArchive: true,
  sizeBytes: 800_000_000,
  runtimeSizeBytes: 250_000_000,
  reasons: [
    'installed CUDA runtime 12.2 < required 12.9 — the companion runtime archive covers this',
    'NVIDIA B200: pack provides native sm_100 kernels (npm runs JIT-degraded here)',
  ],
};

/** `NVIDIA H100, 9.0, 535.129` · banner CUDA 12.2 · cudart 12.9.1: PTX-only and the driver cannot JIT it. */
export const H100_OLD_DRIVER: PackProbe = {
  gpu: { name: 'NVIDIA H100' },
  recommended: false,
  needsRuntimeArchive: false,
  sizeBytes: 800_000_000,
  runtimeSizeBytes: 0,
  reasons: ["driver 535.129 (CUDA 12.2) cannot JIT the pack's 12.9 PTX and no native SASS covers sm_90"],
};

/** `NVIDIA L4, 8.9, 535.129`: the standard npm package carries sm_89 natively; never offered. */
export const L4: PackProbe = {
  gpu: { name: 'NVIDIA L4' },
  recommended: false,
  needsRuntimeArchive: false,
  sizeBytes: 800_000_000,
  runtimeSizeBytes: 0,
  reasons: ['GPU NVIDIA L4 (sm_89) is served natively by the standard npm package'],
};

/** What `nvidia-smi --query-gpu=name --format=csv,noheader` prints on the 2026-07-08 pod: two B200s. */
export const NVIDIA_SMI_NAMES = 'NVIDIA B200\nNVIDIA B200\n';
