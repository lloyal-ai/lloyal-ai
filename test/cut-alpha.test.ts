/**
 * The alpha cutter's pure core — the CLI copy. The script is I/O around it:
 * `npm view`, its own version, and the two templates' exact pins. Everything
 * that can be wrong about a cut is decidable here without a registry.
 */
import { describe, it, expect } from 'vitest';
import { DEPS, arcPackages, parseCut, latestVersion, planAlphas, rewritePins } from '../scripts/cut-alpha.lib.mjs';

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
