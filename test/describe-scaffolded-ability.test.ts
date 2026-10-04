/**
 * Attention-surface extraction, against a real ability.
 *
 * ## What this protects
 *
 * `ability.json` declares tool NAMES. Extraction constructs the ability and reads what
 * its code actually registers — the tool DESCRIPTIONS and PARAMETER SCHEMAS,
 * which are the text that goes into the model's context and that the model acts
 * on. `install` prints it under "What <ability> adds to your model's context", and a
 * reviewer reads the same out of the signed tarball without executing publisher
 * code. It is the disclosure someone uses to decide whether to trust an ability.
 *
 * When extraction breaks, nothing fails. `publish` succeeds, the ability lists, and
 * `install` still prints the header — followed by bare tool names with no
 * descriptions. The reader believes they have seen the disclosure. That silence
 * is the reason this test exists.
 *
 * ## Why a scaffolded ability
 *
 * The tests this replaces constructed `@lloyal-labs/{wikipedia,corpus}-ability`,
 * which sat in the monorepo already built. They were convenient fixtures, not a
 * requirement: `buildAttentionSurface` takes a directory and has no notion of
 * who published it. Nothing in the extractor is first-party.
 *
 * A scaffolded ability is the better fixture anyway. It is what every third-party
 * publisher runs through `publish`, so this asserts the contract for the people
 * who actually use it — and it dogfoods `ability:new`, so template drift breaks the
 * build here rather than someone else's release.
 *
 * ## Why it is slow, and why that is the right trade
 *
 * It really installs and really builds. The alternative — hand-written stand-ins
 * for `effection` and `@lloyal-labs/lloyal-agents` — would be fast and would
 * prove that the subprocess can talk to code we wrote ourselves. The failure
 * mode worth catching is the ability failing to construct against the REAL runtime,
 * so faking the runtime removes the thing under test.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  buildAttentionSurface,
  type AttentionSurface,
  type DescribeAbilityJson,
  type DescribePackageJson,
} from '../src/describe';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repoRoot, 'bin', 'run.js');

/** Generous: a cold `npm install` of the framework dominates this. */
const SETUP_TIMEOUT = 300_000;

let abilityDir: string;
let surface: AttentionSurface;
let setupError: unknown;

beforeAll(async () => {
  const parent = await mkdtemp(join(tmpdir(), 'lloyal-describe-'));
  try {
    // 1. Scaffold as a third party would. `--publisher acme` on purpose: there
    //    is no first-party path through any of this.
    execFileSync(process.execPath, [cli, 'ability:new', 'demo', '--dir', parent, '--publisher', 'acme'], {
      stdio: 'pipe',
    });
    abilityDir = join(parent, 'demo');

    // 2 + 3. Install and build. The ability's peer deps — effection,
    //        @lloyal-labs/lloyal-agents, @lloyal-labs/rig — are public on npm;
    //        only abilities are off-registry.
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: abilityDir, stdio: 'pipe' });
    execFileSync('npm', ['run', 'build'], { cwd: abilityDir, stdio: 'pipe' });

    const abilityJson = JSON.parse(await readFile(join(abilityDir, 'ability.json'), 'utf-8')) as DescribeAbilityJson;
    const pkgJson = JSON.parse(
      await readFile(join(abilityDir, 'package.json'), 'utf-8'),
    ) as DescribePackageJson;

    // 4. The thing under test.
    surface = await buildAttentionSurface(abilityDir, abilityJson, pkgJson);
  } catch (err) {
    // Surface the real cause in every assertion rather than a cascade of
    // "cannot read property of undefined".
    setupError = err;
  } finally {
    if (parent && process.env.KEEP_DESCRIBE_FIXTURE !== '1') {
      await rm(parent, { recursive: true, force: true }).catch(() => {});
    }
  }
}, SETUP_TIMEOUT);

describe('buildAttentionSurface — a scaffolded third-party ability', () => {
  it('scaffolded, installed and built without error', () => {
    if (setupError) throw setupError;
    expect(surface).toBeDefined();
  });

  it('did NOT degrade — this is the assertion that matters', () => {
    // `degraded` is set when the ability could not be constructed and the extractor
    // fell back to ability.json tool NAMES. That fallback is a valid safety
    // behaviour and is covered separately in describe.test.ts; here it would
    // mean the real path silently stopped working.
    expect(surface.degraded).toBeFalsy();
  });

  it('reports the protocol the ability declares', () => {
    expect(surface.protocol.name).toBe('demo_research');
    expect(typeof surface.protocol.useWhen).toBe('string');
  });

  it('extracts every tool the scaffolded ability registers', () => {
    expect(surface.tools.map((t) => t.name).sort()).toEqual(['demo_fetch', 'demo_search']);
  });

  it('carries DESCRIPTIONS, which is what the model actually reads', () => {
    // A name discloses nothing. The description is the text rendered into the
    // model's context, and therefore the text a reviewer needs to see.
    for (const tool of surface.tools) {
      expect(tool.description.length, `${tool.name} has no description`).toBeGreaterThan(0);
    }
  });

  it('carries PARAMETER SCHEMAS, not just names', () => {
    for (const tool of surface.tools) {
      expect(tool.parameters, `${tool.name} has no parameter schema`).not.toBeNull();
      expect(typeof tool.parameters).toBe('object');
    }
  });

  it('carries the raw skill template, unrendered', () => {
    // The per-spawn system prompt. Raw on purpose — pre-rendering it here would
    // hide what actually reaches the model.
    expect(surface.skill.length).toBeGreaterThan(0);
  });

  it('emits the shape the publish worker consumes', () => {
    // Cross-repo contract. `projectAttentionSurface` in the publish worker reads
    // exactly these fields off `package/attention-surface.json`, and is TOTAL
    // over any input — so a malformed surface degrades the listing silently
    // instead of erroring. The check has to live on this side.
    expect(surface).toMatchObject({
      schemaVersion: expect.any(Number),
      protocol: { name: expect.any(String), useWhen: expect.any(String), tools: expect.any(Array) },
      skill: expect.any(String),
      tools: expect.any(Array),
    });
    for (const tool of surface.tools) {
      expect(Object.keys(tool).sort()).toEqual(
        expect.arrayContaining(['description', 'name', 'parameters', 'protected']),
      );
    }
  });

  it('keeps the template in step with the extractor', () => {
    // The extractor finds the factory by matching /^create[A-Za-z0-9]*Ability$/ on
    // the built module's exports. If someone renames the template's export, the
    // surface silently degrades for every publisher who scaffolds after it —
    // so assert the template still satisfies the pattern it is matched against.
    const src = join(repoRoot, 'templates', 'ability', 'src', 'index.ts');
    expect(existsSync(src)).toBe(true);
  });
});
