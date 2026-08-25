import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import { Wizard, orderTargets } from '../src/commands/new-wizard.js';
import { MODEL_FOOTPRINT_HINT, modelsForRole } from '../src/scaffold/model-catalog.js';
import { join, dirname } from 'node:path';

// COVERAGE BOUNDARY: the full keystroke-driven flow (name → targets → model →
// template) is NOT asserted here. Character input to @inkjs/ui's `TextInput`
// does not deliver under ink-testing-library's simulated stdin (the field keeps
// showing its placeholder), so an end-to-end keystroke test can't be driven
// headlessly — it needs a human smoke in a real terminal before release. What
// IS covered: the wizard mounts + renders the name prompt (below); the
// "cli always kept" invariant it enforces (orderTargets, below); and the pure
// scaffold logic it hands off to (pruneTargets / applyModelChoice — see
// new-scaffold.test.ts). The wizard drives the SAME @inkjs/ui TextInput/
// Select components the shipped `targets/cli/view.tsx` templates use.

describe('new wizard — render', () => {
  it('mounts and renders the name prompt first (no crash)', () => {
    const { lastFrame } = render(createElement(Wizard, { onDone: () => {} }));
    expect(lastFrame()).toContain('Scaffold a new harness');
    expect(lastFrame()).toContain('Harness name');
  });
});

describe('MODEL_FOOTPRINT_HINT — the hardware floor shown at the model step', () => {
  // The keystroke flow can't be driven headlessly (see the coverage boundary
  // above), so the model step's frame isn't asserted. What IS worth pinning is
  // the CONTENT: the download figure is derived from rig's catalog, and the
  // vendored copy in model-catalog.ts already carries a "keep in sync" warning.
  // Without this, rig can swap the recommended model and the wizard keeps
  // quoting a stale size at the exact moment the user commits to it.
  // Pinned, not read from rig. This used to parse `sizeBytes` straight out of
  // `packages/rig/src/models.ts`, which was the sharpest form of the check but
  // is impossible now the CLI lives in its own repo.
  //
  // SOURCE OF TRUTH: `MODEL_CATALOG` in @lloyal-labs/rig (`src/models.ts`). If
  // rig restates any of these sizes, the matching label in
  // `src/scaffold/model-catalog.ts` must move with it. Nothing enforces that
  // across the repo boundary any more — see lloyal-ai/lloyal-ai#1.
  //
  // The figures moved from the hint onto the rows when the catalog gained a
  // 16.5 GB option, because one sentence cannot describe both. The guard
  // followed them rather than being dropped.
  const RIG_SIZE_BYTES: Record<string, number> = {
    'qwen3.5-4b': 2_600_000_000,
    'qwen3.8-27b-q4': 16_464_440_224,
    'qwen3.8-27b-iq1': 6_192_222_208,
  };

  it('every llm row quotes a download size matching rig’s sizeBytes', () => {
    const llms = modelsForRole('llm');
    expect(llms.length).toBeGreaterThan(0);
    for (const m of llms) {
      const expected = RIG_SIZE_BYTES[m.id];
      expect(expected, `no pinned size for catalog id "${m.id}"`).toBeDefined();
      const quoted = Number(/([\d.]+)\s*GB download/.exec(m.label)?.[1] ?? NaN);
      expect(Number.isFinite(quoted), `label "${m.label}" quotes no size`).toBe(true);
      // Same figure to one decimal, in GB as a human reads it.
      expect(quoted).toBeCloseTo(expected / 1e9, 1);
    }
  });

  it('states that concurrent agents do not multiply the requirement', () => {
    // The counter-intuitive half, and the reason the hint exists at all —
    // readers assume four agents means four times the model.
    expect(MODEL_FOOTPRINT_HINT).toMatch(/share one context/i);
    expect(MODEL_FOOTPRINT_HINT).toMatch(/16 GB/);
  });
});

describe('orderTargets — cli is never droppable', () => {
  it('re-adds cli even when the user unchecked it', () => {
    expect(orderTargets(['web'])).toEqual(['cli', 'web']);
    expect(orderTargets([])).toEqual(['cli']);
    expect(orderTargets(['desktop', 'web'])).toEqual(['cli', 'desktop', 'web']);
  });

  it('returns targets in canonical order regardless of selection order', () => {
    expect(orderTargets(['web', 'desktop', 'cli'])).toEqual(['cli', 'desktop', 'web']);
  });
});
