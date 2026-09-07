/**
 * The alpha cutter's pure core — the CLI copy. The script is I/O around it:
 * `npm view`, its own version, and the two templates' exact pins. Everything
 * that can be wrong about a cut is decidable here without a registry.
 */
import { describe, it, expect } from 'vitest';
import { DEPS, arcPackages, parseCut, latestVersion, planAlphas, rewritePins, include, unclosed } from '../scripts/cut-alpha.lib.mjs';

const e404 = Object.assign(new Error('npm ERR! code E404'), { stderr: 'npm ERR! code E404\nnpm ERR! 404 Not Found' });
const reset = Object.assign(new Error('npm ERR! code ECONNRESET'), { stderr: 'npm ERR! code ECONNRESET' });

describe('parseCut', () => {
  it('accepts a non-negative integer and nothing else', () => {
    expect(parseCut('2')).toBe(2);
    for (const bad of [undefined, '', 'x', '-1', '1.5', '9'.repeat(400)]) {
      expect(() => parseCut(bad as string), String(bad).slice(0, 12)).toThrow(/--cut/);
    }
  });
});

describe('latestVersion', () => {
  it('falls back ONLY on a registry 404; every other failure aborts the cut', () => {
    expect(latestVersion('@x/new', '0.1.0', () => { throw e404; })).toBe('0.1.0');
    expect(() => latestVersion('@x/sdk', '3.1.0', () => { throw reset; })).toThrow(/ECONNRESET/);
    expect(latestVersion('@x/sdk', '3.1.0', () => '3.1.4\n')).toBe('3.1.4');
  });
});

describe('planAlphas', () => {
  it('is a golden over the REAL table: what cut 1 stamps from the registry as it stood', () => {
    // The table is imported, not copied. An earlier version of this test kept
    // its own list, said sdk was a minor while the script said major, and
    // stayed green while the cutter would have stamped 4.0.0 — a golden that
    // cannot see the table it is a golden OF proves nothing.
    const registry: Record<string, string> = {
      '@lloyal-labs/lloyal.node': '3.1.1', '@lloyal-labs/sdk': '3.1.0', '@lloyal-labs/lloyal-agents': '5.5.1',
      '@lloyal-labs/rig': '5.5.0', '@lloyal-labs/dev-tools': '0.4.3', 'lloyal-ai': '1.10.0',
    };
    const view = (name: string) => { if (name in registry) return registry[name]; throw e404; };
    const alphas = planAlphas({ cut: 1, packages: arcPackages(DEPS), view });
    expect(alphas).toEqual({
      '@lloyal-labs/lloyal.node': '3.2.0-alpha.1',
      '@lloyal-labs/media': '0.2.0-alpha.1',
      '@lloyal-labs/sdk': '4.0.0-alpha.1',
      '@lloyal-labs/lloyal-agents': '6.0.0-alpha.1',
      '@lloyal-labs/rig': '5.6.0-alpha.1',
      '@lloyal-labs/dev-tools': '0.5.0-alpha.1',
      'lloyal-ai': '1.11.0-alpha.1',
    });
  });
});

describe('include', () => {
  const planned = {
    'lloyal-ai': '1.11.0-alpha.4',
    '@lloyal-labs/media': '0.2.0-alpha.4',
    '@lloyal-labs/lloyal.node': '3.2.0-alpha.4',
  };

  it('a member left OUT keeps the pin the template already carries', () => {
    // The defect this exists for: the binding was in the table but shipped
    // nothing, so the cut stamped a version the registry would never serve.
    const set = include(planned, ['lloyal-ai', '@lloyal-labs/media']);
    const pkg = {
      dependencies: {
        '@lloyal-labs/media': '0.2.0-alpha.3',
        '@lloyal-labs/lloyal.node': '3.2.0-alpha.3',
      },
    };
    rewritePins(pkg, set);
    expect(pkg.dependencies['@lloyal-labs/media']).toBe('0.2.0-alpha.4');
    expect(pkg.dependencies['@lloyal-labs/lloyal.node']).toBe('3.2.0-alpha.3');
  });

  it('no names at all is refused — absence must cut nothing, never everything', () => {
    // The old behaviour was "empty means the whole table", which is precisely
    // how a member that shipped nothing got a version stamped for it.
    expect(() => include(planned, [])).toThrow(/--include <name> is required/);
  });

  it('an unknown name throws — a typo must not silently shrink the cut', () => {
    expect(() => include(planned, ['lloyal-ia'])).toThrow(/not in the cut/);
  });
});

describe('unclosed', () => {
  const templates = [
    { path: 'templates/research', pkg: { dependencies: { '@lloyal-labs/media': '0.2.0-alpha.3', sharp: '^0.35.4' } } },
    { path: 'templates/basic', pkg: { dependencies: { effection: '^4' } } },
  ];

  it('moving a template pin without moving lloyal-ai is refused — the templates ride ITS tarball', () => {
    // git would record the new pin; the published CLI would keep scaffolding
    // the previous set, and nobody would see the difference until a scaffold.
    expect(unclosed({ '@lloyal-labs/media': '0.2.0-alpha.4' }, templates))
      .toEqual([{ template: 'templates/research', dep: '@lloyal-labs/media' }]);
  });

  it('is silent once lloyal-ai is in the cut, which is the normal case', () => {
    const set = { 'lloyal-ai': '1.11.0-alpha.4', '@lloyal-labs/media': '0.2.0-alpha.4' };
    expect(unclosed(set, templates)).toEqual([]);
  });
});

describe('rewritePins', () => {
  const alphas = { '@lloyal-labs/sdk': '3.2.0-alpha.1', '@lloyal-labs/media': '0.2.0-alpha.1' };

  it('pins every alpha dependency exactly — devDependencies included, where the template keeps media', () => {
    const pkg = {
      dependencies: { '@lloyal-labs/sdk': '3.2.0-alpha.0', effection: '^4.1.0' },
      devDependencies: { '@lloyal-labs/media': '0.2.0-alpha.0', vitest: '^4' },
    };
    expect(rewritePins(pkg, alphas)).toBe(true);
    expect(pkg.dependencies['@lloyal-labs/sdk']).toBe('3.2.0-alpha.1');
    expect(pkg.devDependencies['@lloyal-labs/media']).toBe('0.2.0-alpha.1');
    expect(pkg.dependencies.effection).toBe('^4.1.0');
    expect(pkg.devDependencies.vitest).toBe('^4');
  });

  it('reports no change when every pin already matches', () => {
    const pkg = { dependencies: { '@lloyal-labs/sdk': '3.2.0-alpha.1' } };
    expect(rewritePins(pkg, alphas)).toBe(false);
  });
});
