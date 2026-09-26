/**
 * What a project selects for a model role, as the boot will see it: the local overlay over the committed
 * manifest, per key — `harness.json`'s `path` over `harness.yml`'s, its `id` over the manifest's — and then
 * `path` over `id`. The keys that select a model have no environment or flag rung, so this is the whole of
 * the layering that matters here. A block present in either file is a request; a commented-out one is not.
 *
 * Presence is rig's rule, mirrored: a block is a mapping or a bare key (`reranker:` alone); a scalar where a
 * block belongs is a value the key cannot take — refused from the committed manifest, dropped from the local
 * overlay. `test/platform-mirror.test.ts` runs the same cases through rig's loader and this.
 */
import { hasHarnessYml, openHarnessYml } from './harness-yml.js';
import { readLocalModel } from './harness-json.js';
import type { ModelSpec, Role } from './apply-model.js';

export interface ModelSelection {
  /** Whether the project names the block at all — `reranker: {}` is present and selects nothing. */
  present: boolean;
  /** The model the block selects, or null when it names neither `path` nor `id`. */
  spec: ModelSpec | null;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
/** A block: a mapping, or a bare key the parser reads as null. */
const isBlock = (v: unknown): v is Record<string, unknown> | null => v === null || (typeof v === 'object' && !Array.isArray(v));

export function modelSelection(projectDir: string, role: Role): ModelSelection {
  const local = readLocalModel(projectDir)?.[role];
  let committed: { present: boolean; id?: string; path?: string } = { present: false };
  if (hasHarnessYml(projectDir)) {
    const yml = openHarnessYml(projectDir);
    if (yml.has(['model', role])) {
      const node = yml.get(['model', role]);
      if (!isBlock(node)) throw new Error(`harness.yml: model.${role} must be a block of keys (got ${JSON.stringify(node)})`);
      committed = { present: true, id: str(node?.id), path: str(node?.path) };
    }
  }
  const path = str(local?.path) ?? committed.path;
  const id = str(local?.id) ?? committed.id;
  return {
    present: local !== undefined || committed.present,
    spec: path ? { path } : id ? { id } : null,
  };
}
