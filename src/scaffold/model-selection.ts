/**
 * What a project selects for a model role, as the boot will see it: the local overlay over the committed
 * manifest, per key — `harness.json`'s `path` over `harness.yml`'s, its `id` over the manifest's — and then
 * `path` over `id`. The keys that select a model have no environment or flag rung, so this is the whole of
 * the layering that matters here. A block present in either file is a request; a commented-out one is not.
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

export function modelSelection(projectDir: string, role: Role): ModelSelection {
  const local = readLocalModel(projectDir)?.[role];
  let committed: { present: boolean; id?: string; path?: string } = { present: false };
  if (hasHarnessYml(projectDir)) {
    const yml = openHarnessYml(projectDir);
    committed = {
      present: yml.has(['model', role]),
      id: str(yml.get(['model', role, 'id'])),
      path: str(yml.get(['model', role, 'path'])),
    };
  }
  const path = str(local?.path) ?? committed.path;
  const id = str(local?.id) ?? committed.id;
  return {
    present: local !== undefined || committed.present,
    spec: path ? { path } : id ? { id } : null,
  };
}
