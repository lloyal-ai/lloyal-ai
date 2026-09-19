/**
 * The front-door gate.
 *
 * `lloyal-ai@1.0.0` shipped templates whose SOURCE had been renamed to the 5.x
 * API while their package.json still pinned `lloyal-agents@^3.4.0` and
 * `rig@^3.8.0`, and while DEFAULT_ABILITIES still named the pre-rename ability
 * versions whose import names end `-app`. Every `npx lloyal-ai new` produced a
 * project that could not typecheck: the emitted harness imported
 * `createAbilityRegistry` and `@lloyal-labs/wikipedia-ability`, and npm installed
 * packages exporting `createAppRegistry` and `@lloyal-labs/wikipedia-app`.
 *
 * The whole 171-test suite was green throughout, because every test that touched
 * a version asserted it against the same constant that was wrong. A fixture
 * agreeing with the code it is meant to check proves only that someone typed the
 * number twice.
 *
 * So these assert the RELATIONSHIP between the two halves instead — that what a
 * template imports and what it installs are on the same side of the rename.
 * Offline by design: it must fail in a fresh clone with no network.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ABILITIES } from '../src/commands/new';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = join(root, 'templates');
const templates = readdirSync(templatesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

/** Every renamed runtime export lives behind one of these majors. */
const MIN_MAJOR: Record<string, number> = {
  '@lloyal-labs/lloyal-agents': 5,
  '@lloyal-labs/rig': 5,
};

/** The rename landed in ability 2.0.0; 1.x import names all end `-app`. */
const RENAME_BOUNDARY_MAJOR = 2;

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|js|jsx|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('templates cannot drift from the runtime they pin', () => {
  it('finds the templates at all', () => {
    // Guards the rest: a bad path would make every loop below vacuously pass.
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates)('%s pins majors that export the symbols it imports', (name) => {
    const pkgPath = join(templatesDir, name, 'package.json');
    if (!existsSync(pkgPath)) return;
    const pkg = readJson(pkgPath);
    const ranges = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies };
    for (const [dep, min] of Object.entries(MIN_MAJOR)) {
      const range = ranges[dep];
      if (!range) continue;
      const major = Number(String(range).replace(/^[^0-9]*/, '').split('.')[0]);
      expect(
        major,
        `${name}/package.json pins ${dep}@${range}, whose exports predate the Ability rename`,
      ).toBeGreaterThanOrEqual(min);
    }
  });

  it.each(templates)('%s never imports a pre-rename ability package', (name) => {
    const offenders = sourceFiles(join(templatesDir, name))
      .filter((f) => /@lloyal-labs\/[a-z0-9-]+-app\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1));
    expect(offenders, 'these reference *-app import names, which 2.0.0 replaced').toEqual([]);
  });

  it('every default ability is on the post-rename side', () => {
    // The abilities that existed before the rename — the only names a 1.x
    // `*-app` tarball was ever published under. An ability born after it
    // (documents, 0.1.0) has no pre-rename tarball to pin by mistake.
    const RENAMED = ['corpus', 'web', 'wikipedia'];
    const specs = Object.values(DEFAULT_ABILITIES).flat();
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const name = spec.slice(spec.indexOf('/') + 1, spec.lastIndexOf('@'));
      if (!RENAMED.includes(name)) continue;
      const version = spec.split('@').pop()!;
      const major = Number(version.split('.')[0]);
      expect(
        major,
        `DEFAULT_ABILITIES pins ${spec}; 1.x vendors a tarball named *-app, which no template imports`,
      ).toBeGreaterThanOrEqual(RENAME_BOUNDARY_MAJOR);
    }
  });

  it('a scaffolded manifest declares the field the runtime reads', () => {
    // The scaffolder wrote `appProtocolVersion` after the rename, which nothing
    // reads. Neither half fails on it: `assertAbilityProtocolVersion` returns
    // early when the version is undefined, and the publish worker falls back to
    // its own constant. So the declaration is silently discarded rather than
    // rejected — and stays wrong until the supported set changes, at which point
    // an ability that believed it declared 3.0 has declared nothing.
    for (const name of templates) {
      const manifestPath = join(templatesDir, name, 'ability.json');
      if (!existsSync(manifestPath)) continue;
      const raw = readFileSync(manifestPath, 'utf8');
      expect(raw, `templates/${name}/ability.json still writes appProtocolVersion`).not.toMatch(
        /\bappProtocolVersion\b/,
      );
      expect(
        readJson(manifestPath).abilityProtocolVersion,
        `templates/${name}/ability.json must declare abilityProtocolVersion`,
      ).toBeTypeOf('string');
    }
  });

  it('every ability a template imports is one the scaffolder actually vendors', () => {
    // The precise break: basic/harness.ts imported `@lloyal-labs/wikipedia-ability`
    // while DEFAULT_ABILITIES.basic vendored wikipedia@1.2.0 → `*-wikipedia-app`.
    const vendored = new Set(
      Object.values(DEFAULT_ABILITIES)
        .flat()
        .map((s) => s.split('@')[0].split('/')[1]),
    );
    for (const name of templates) {
      const dir = join(templatesDir, name);
      const imported = new Set<string>();
      for (const f of sourceFiles(dir)) {
        for (const m of readFileSync(f, 'utf8').matchAll(
          /@lloyal-labs\/([a-z0-9-]+)-ability\b/g,
        )) {
          imported.add(m[1]);
        }
      }
      for (const short of imported) {
        expect(
          vendored.has(short),
          `templates/${name} imports @lloyal-labs/${short}-ability, but no DEFAULT_ABILITIES entry vendors it`,
        ).toBe(true);
      }
    }
  });
});
