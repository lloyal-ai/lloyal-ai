import { describe, it, expect, afterEach, vi } from 'vitest';
import { cpSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneTargets, type Target } from '../src/scaffold/prune-targets.js';
import { addTarget } from '../src/scaffold/add-target.js';
import { readJsoncArray } from '../src/scaffold/jsonc.js';
import { applyModelChoice, isModelPath, readModelField } from '../src/scaffold/apply-model.js';
import { modelsForRole, MODEL_CATALOG } from '../src/scaffold/model-catalog.js';
import { newCommand } from '../src/commands/new.js';

const BASIC_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'basic');

const created: string[] = [];
function freshBlankProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-scaffold-'));
  cpSync(BASIC_TEMPLATE, dir, { recursive: true });
  created.push(dir);
  return dir;
}
function pkg(dir: string): {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('pruneTargets — cli-only', () => {
  it('removes desktop + web dirs, bin shim, and both extra tsconfigs', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli'], 'basic');
    expect(existsSync(join(dir, 'targets/cli'))).toBe(true);
    expect(existsSync(join(dir, 'targets/desktop'))).toBe(false);
    expect(existsSync(join(dir, 'targets/web'))).toBe(false);
    expect(existsSync(join(dir, 'bin/serve.js'))).toBe(false);
    expect(existsSync(join(dir, 'electron.vite.config.ts'))).toBe(false);
    expect(existsSync(join(dir, 'tsconfig.electron.json'))).toBe(false);
    expect(existsSync(join(dir, 'tsconfig.web.json'))).toBe(false);
  });

  it('drops every per-target dep incl. the shared renderer deps', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli'], 'basic');
    const p = pkg(dir);
    for (const dep of ['@lloyal-labs/host', 'ws', 'react-dom']) {
      expect(p.dependencies?.[dep]).toBeUndefined();
    }
    for (const dep of ['electron', 'electron-vite', 'vite', '@vitejs/plugin-react', '@types/ws', '@types/react-dom']) {
      expect(p.devDependencies?.[dep]).toBeUndefined();
    }
    // cli core deps survive
    expect(p.dependencies?.ink).toBeDefined();
    expect(p.dependencies?.react).toBeDefined();
  });

  it('collapses scripts + typecheck to the cli set', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli'], 'basic');
    const p = pkg(dir);
    for (const s of ['dev:desktop', 'build:desktop', 'serve', 'dev:web', 'build:web']) {
      expect(p.scripts[s]).toBeUndefined();
    }
    expect(p.scripts.start).toBeDefined();
    expect(p.scripts.typecheck).toBe('tsc --noEmit');
    expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toMatch(/^targets: \[cli\]$/m);
  });
});

describe('desktop target — the three things electron-vite needs', () => {
  const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

  it.each(['basic', 'research'] as const)(
    '%s: package.json declares the Electron entry point',
    (template) => {
      // electron-vite refuses to launch without it: "No entry point found for
      // electron app, please add a 'main' field to package.json".
      const pkgJson = JSON.parse(readFileSync(join(TEMPLATES, template, 'package.json'), 'utf8'));
      expect(pkgJson.main).toBe('out/main/main.js');
    },
  );

  it.each(['basic', 'research'] as const)(
    '%s: the preload path matches what electron-vite emits',
    (template) => {
      // electron-vite names the bundle after its entry and emits ESM as .mjs, so
      // `out/preload/preload.mjs`. Pointing at `index.js` fails SILENTLY — no
      // bridge, blank window.
      const main = readFileSync(join(TEMPLATES, template, 'targets/desktop/main.ts'), 'utf8');
      const entry = readFileSync(join(TEMPLATES, template, 'electron.vite.config.ts'), 'utf8');
      expect(entry).toContain('targets/desktop/preload.ts');
      expect(main).toContain('"../preload/preload.mjs"');
      expect(main).not.toContain('"../preload/index.js"');
    },
  );

  it.each(['basic', 'research'] as const)(
    '%s: the desktop scripts guard the Electron binary first',
    (template) => {
      // electron 42 dropped `postinstall: node install.js`, so `npm install`
      // never fetches the binary and electron-vite dies with "Electron uninstall".
      const pkgJson = JSON.parse(readFileSync(join(TEMPLATES, template, 'package.json'), 'utf8'));
      expect(pkgJson.scripts['predev:desktop']).toContain('node bin/ensure-electron.js');
      expect(pkgJson.scripts['prebuild:desktop']).toContain('node bin/ensure-electron.js');
      expect(existsSync(join(TEMPLATES, template, 'bin/ensure-electron.js'))).toBe(true);
      // The pin must stay on a version whose binary this guard can fetch.
      expect(pkgJson.devDependencies.electron).toMatch(/\^4[2-9]\./);
    },
  );

  it('cli-only prunes `main`, the guard script, and both pre* hooks', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli'], 'basic');
    const p = pkg(dir) as { main?: string; scripts: Record<string, string> };
    expect(p.main).toBeUndefined(); // out/ is desktop-only — a dangling entry point
    expect(p.scripts['predev:desktop']).toBeUndefined();
    expect(p.scripts['prebuild:desktop']).toBeUndefined();
    expect(existsSync(join(dir, 'bin/ensure-electron.js'))).toBe(false);
  });

  it('keeping desktop keeps all three', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli', 'desktop'], 'basic');
    const p = pkg(dir) as { main?: string; scripts: Record<string, string> };
    expect(p.main).toBe('out/main/main.js');
    expect(p.scripts['prebuild:desktop']).toContain('node bin/ensure-electron.js');
    expect(existsSync(join(dir, 'bin/ensure-electron.js'))).toBe(true);
  });
});

describe('preflight-abilities — the ability guard runs before the compiler', () => {
  const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

  it.each(['basic', 'research'] as const)(
    '%s: prestart and both desktop pre-hooks run the guard first',
    (template) => {
      // `harness/harness.ts` imports its abilities at the top level, so a scaffold
      // missing them fails inside tsc with TS2307 — the compiler complaining
      // about a supply problem. The guard has to run AHEAD of the build step.
      const pkgJson = JSON.parse(readFileSync(join(TEMPLATES, template, 'package.json'), 'utf8'));
      for (const s of ['prestart', 'predev:desktop', 'prebuild:desktop']) {
        expect(pkgJson.scripts[s].startsWith('node bin/preflight-abilities.js &&')).toBe(true);
      }
      expect(existsSync(join(TEMPLATES, template, 'bin/preflight-abilities.js'))).toBe(true);
    },
  );

  it('is cli-owned: a cli-only prune keeps the guard and prestart', () => {
    // Unlike ensure-electron.js it must NOT be in TARGET_FILES — `prestart`
    // belongs to the cli target, which is never pruned.
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli'], 'basic');
    const p = pkg(dir) as { scripts: Record<string, string> };
    expect(existsSync(join(dir, 'bin/preflight-abilities.js'))).toBe(true);
    expect(p.scripts.prestart).toContain('node bin/preflight-abilities.js');
  });
});

describe('the shared React view outlives either DOM target alone', () => {
  const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
  const SHARED = 'src/ui/App.tsx';

  /** Entries of a JSONC array field, comments stripped. */
  function jsoncArray(file: string, key: string): string[] {
    return readJsoncArray(file, key);
  }

  it.each([
    ['cli,web (desktop pruned)', ['cli', 'web']],
    ['cli,desktop (web pruned)', ['cli', 'desktop']],
  ] as const)('%s keeps it — the surviving target still mounts it', (_label, keep) => {
    const dir = freshBlankProject();
    pruneTargets(dir, keep as unknown as Target[], 'basic');
    expect(existsSync(join(dir, SHARED))).toBe(true);
    // …and typecheck still covers it. The whole view dir is one include entry.
    expect(jsoncArray(join(dir, 'tsconfig.web.json'), 'include')).toContain('src/ui/**/*');
  });

  it('cli-only KEEPS it — inert, not broken', () => {
    // The view now lives under `src/ui/` beside the state the TERMINAL view also
    // folds, so no directory there belongs to the DOM targets alone. A cli-only
    // project carries the React files unused rather than splitting `src/ui/` in
    // two to save them — the same trade `research` has always made.
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli'], 'basic');
    expect(existsSync(join(dir, SHARED))).toBe(true);
    expect(existsSync(join(dir, 'src/ui/state.ts'))).toBe(true);
    // The Node build still excludes the DOM sources, or `tsc` compiles React.
    expect(jsoncArray(join(dir, 'tsconfig.json'), 'exclude')).toContain('src/ui/App.tsx');
  });

  /**
   * Every module specifier in a file, across all three import forms — `from "x"`,
   * side-effect `import "x"`, and dynamic `import("x")` (which also covers
   * `export … from`). Matching the SPECIFIER rather than the import syntax is
   * what makes this depth- and form-agnostic; the earlier version only saw
   * `from "../x/"` and would have missed a side-effect CSS import outright.
   */
  function specifiers(file: string): string[] {
    const src = readFileSync(file, 'utf8');
    return [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]);
  }

  function walkSources(dir: string, fn: (file: string) => void): void {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkSources(p, fn);
      else if (/\.(ts|tsx)$/.test(e.name)) fn(p);
    }
  }

  it.each(['basic', 'research'] as const)(
    '%s: no target imports across into another target',
    (template) => {
      // THE INVARIANT. web/main.tsx used to import ../desktop/App.js, so pruning
      // desktop stranded it — broken since 0.6.4 and caught by nothing, because
      // the all-three default scaffold resolves fine. Any future shared file
      // parked inside one target trips this.
      const root = join(TEMPLATES, template, 'targets');
      const offenders: string[] = [];
      for (const owner of ['cli', 'desktop', 'web']) {
        walkSources(join(root, owner), (file) => {
          for (const spec of specifiers(file)) {
            if (!spec.startsWith('.')) continue;
            // Resolve rather than pattern-match, so `../../desktop/x` and
            // `../desktop/x` are judged the same way.
            const rel = relative(root, resolve(dirname(file), spec));
            const [dir] = rel.split(sep);
            if (rel.startsWith('..') || dir === owner) continue;
            offenders.push(`${owner}/${basename(file)} → ${dir}`);
          }
        });
      }
      expect(offenders).toEqual([]);
    },
  );

  it.each(['basic', 'research'] as const)(
    '%s: declares a Node floor, so an old runtime fails at install not inside vite',
    (template) => {
      // The templates declared NO engines at all, so a scaffold asserted nothing
      // and Node 18 surfaced as an opaque vite failure. The floor must also
      // match the CLI's own, or the docs and the two package.jsons disagree.
      const tpl = JSON.parse(readFileSync(join(TEMPLATES, template, 'package.json'), 'utf8'));
      const cli = JSON.parse(
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
      );
      expect(tpl.engines?.node).toBe('>=24');
      expect(tpl.engines.node).toBe(cli.engines.node);
    },
  );

  it.each(['basic', 'research'] as const)(
    '%s: the harness runtime path has no dynamic import()',
    (template) => {
      // Metro needs a statically analysable module graph, so a dynamic import
      // under harness/ or targets/ forecloses a future React Native target.
      // `bin/` is exempt on purpose — those are boot shims, not runtime.
      const offenders: string[] = [];
      // The harness centre is `src/` in both templates; `bin/` is exempt in
      // either (boot shims, not runtime).
      const centre = 'src';
      for (const sub of [centre, 'targets']) {
        walkSources(join(TEMPLATES, template, sub), (file) => {
          if (/\bimport\s*\(/.test(readFileSync(file, 'utf8'))) {
            offenders.push(relative(join(TEMPLATES, template), file));
          }
        });
      }
      expect(offenders).toEqual([]);
    },
  );
});

describe('pruneTargets — research: the view stays, its DOM deps do not', () => {
  const RESEARCH_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'research');

  function freshResearchProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'harness-scaffold-r-'));
    cpSync(RESEARCH_TEMPLATE, dir, { recursive: true });
    created.push(dir);
    return dir;
  }

  it('cli-only keeps every src/ui file and the whole suite, and drops the DOM deps', () => {
    // research keeps its view beside the fold, so a cli-only scaffold carries DOM
    // files no tsconfig covers and whose `react-dom` is gone. That is the accepted
    // trade: inert, not broken, and the alternative was splitting `src/ui/` in two.
    const dir = freshResearchProject();
    pruneTargets(dir, ['cli'], 'research');
    for (const rel of ['src/ui/App.tsx', 'src/ui/parts/Shell.tsx', 'src/ui/moments/Ask.tsx', 'src/ui/theme.ts', 'src/ui/history.ts']) {
      expect(existsSync(join(dir, rel)), `${rel} must survive: src/ui is not pruned`).toBe(true);
    }
    // The suite is the developer's and none of it rides a target: it survives whole.
    for (const rel of ['test/invariants/reducer.test.ts', 'test/invariants/history.test.ts', 'test/invariants/harness.ts', 'test/invariants/kv-law.scenario.test.ts']) {
      expect(existsSync(join(dir, rel)), `${rel} must survive a cli-only prune`).toBe(true);
    }
    const p = pkg(dir);
    for (const dep of ['react-dom', '@fontsource-variable/geist', '@fontsource-variable/geist-mono']) {
      expect(p.dependencies?.[dep], `${dep} is a DOM dep and should go`).toBeUndefined();
    }
    // The shell package the desktop main + preload import goes with its target…
    expect(p.dependencies?.['@lloyal-labs/desktop']).toBeUndefined();
    // …while `@lloyal-labs/ui` stays: the fold and the reducer import `foldAgents`
    // from it, and the terminal view folds through those.
    expect(p.dependencies?.['@lloyal-labs/ui'], 'ui is a cli dependency, not a renderer one').toBeDefined();
    expect(existsSync(join(dir, 'targets/_shared'))).toBe(false); // research never had one
  });

  it('a surviving DOM target keeps the DOM deps, and desktop still takes its own', () => {
    const dir = freshResearchProject();
    pruneTargets(dir, ['cli', 'web'], 'research');
    const p = pkg(dir);
    expect(p.dependencies?.['react-dom']).toBeDefined();
    expect(p.dependencies?.['@fontsource-variable/geist']).toBeDefined();
    expect(p.dependencies?.['@lloyal-labs/desktop']).toBeUndefined();
    expect(p.dependencies?.['@lloyal-labs/ui']).toBeDefined();
  });
});

describe('pruneTargets — cli + web (desktop pruned)', () => {
  it('keeps web deps/scripts, drops only desktop, trims tsconfig.web include', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli', 'web'], 'basic');
    expect(existsSync(join(dir, 'targets/web'))).toBe(true);
    expect(existsSync(join(dir, 'targets/desktop'))).toBe(false);
    expect(existsSync(join(dir, 'electron.vite.config.ts'))).toBe(false);
    expect(existsSync(join(dir, 'tsconfig.electron.json'))).toBe(false);
    expect(existsSync(join(dir, 'tsconfig.web.json'))).toBe(true);

    const p = pkg(dir);
    expect(p.devDependencies?.electron).toBeUndefined();
    expect(p.devDependencies?.['electron-vite']).toBeUndefined();
    expect(p.devDependencies?.vite).toBeDefined(); // shared renderer dep kept — web survives
    expect(p.dependencies?.['react-dom']).toBeDefined();
    expect(p.scripts.serve).toBeDefined();
    expect(p.scripts['dev:desktop']).toBeUndefined();
    expect(p.scripts.typecheck).toBe('tsc --noEmit && tsc -p tsconfig.web.json');

    const webCfg = readFileSync(join(dir, 'tsconfig.web.json'), 'utf8');
    expect(webCfg).not.toContain('targets/desktop');
    expect(webCfg).toContain('targets/web/main.tsx');
    expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toMatch(/^targets: \[cli, web\]$/m);
  });
});

describe('pruneTargets — guards', () => {
  it('throws when cli is not kept', () => {
    const dir = freshBlankProject();
    expect(() => pruneTargets(dir, ['desktop', 'web'], 'basic')).toThrow(/cli.*mandatory/i);
  });

  it('all three kept is a no-op for the target dirs', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli', 'desktop', 'web'], 'basic');
    expect(existsSync(join(dir, 'targets/desktop'))).toBe(true);
    expect(existsSync(join(dir, 'targets/web'))).toBe(true);
  });
});

// A prune that cannot finish must not start: every file it will rewrite is parsed before anything is
// deleted, so a manifest the parser rejects — or a package.json that is not JSON — leaves the project
// exactly as it was, rather than half-pruned with its marker and manifest describing the old set.
describe('the targets verbs read before they write', () => {
  it('pruneTargets refuses a malformed harness.yml before deleting anything', () => {
    const dir = freshBlankProject();
    writeFileSync(join(dir, 'harness.yml'), 'targets: [cli, desktop, web\nmodel: {\n');
    expect(() => pruneTargets(dir, ['cli'], 'basic')).toThrow(/harness\.yml/);
    expect(existsSync(join(dir, 'targets/desktop'))).toBe(true);
    expect(existsSync(join(dir, 'targets/web'))).toBe(true);
    expect(pkg(dir).scripts['dev:desktop']).toBeDefined();
  });

  it('pruneTargets refuses a package.json that is not JSON before deleting anything', () => {
    const dir = freshBlankProject();
    writeFileSync(join(dir, 'package.json'), '{ "name": "broken",');
    expect(() => pruneTargets(dir, ['cli'], 'basic')).toThrow();
    expect(existsSync(join(dir, 'targets/desktop'))).toBe(true);
    expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toMatch(/^targets: \[cli, desktop, web\]$/m);
  });

  // JSON.parse accepts every one of these; only the shape check refuses them, and it must do so before the rm.
  it.each(['null', '[]', '42', '{ "name": "x", "scripts": "build" }', '{ "name": "x", "scripts": [] }', '{ "name": "x", "dependencies": ["react"] }'])(
    'pruneTargets refuses a package.json of %s before deleting anything', (text) => {
      const dir = freshBlankProject();
      writeFileSync(join(dir, 'package.json'), text);
      expect(() => pruneTargets(dir, ['cli'], 'basic')).toThrow(/package\.json.*object/);
      expect(existsSync(join(dir, 'targets/desktop'))).toBe(true);
      expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toMatch(/^targets: \[cli, desktop, web\]$/m);
    },
  );

  // An array section is the quiet failure: JavaScript takes a named property on an array, JSON serialization
  // drops it, and the verb would report success having saved nothing. So the shape check refuses it, and a
  // successful addition is asserted to have PERSISTED its scripts and dependencies, not merely returned.
  it('addTarget persists the scripts, the dependencies and the manifest line it adds', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli'], 'basic');
    expect(pkg(dir).scripts['serve']).toBeUndefined();
    expect(addTarget(dir, 'web', 'basic')).toEqual(['cli', 'web']);
    const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(after.scripts.serve).toBeDefined();
    expect(after.scripts['dev:web']).toBeDefined();
    // basic's web target owns no runtime dependency of its own; its dev dependencies are what come back.
    expect(after.devDependencies['@types/ws']).toBeDefined();
    expect(after.devDependencies.concurrently).toBeDefined();
    expect(existsSync(join(dir, 'targets/web'))).toBe(true);
    expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toMatch(/^targets: \[cli, web\]$/m);
  });

  it.each(['{ "name": "x", "devDependencies": "electron" }', '{ "name": "x", "scripts": [] }', '{ "name": "x", "dependencies": 42 }'])(
    'addTarget refuses a package.json of %s before copying anything', (text) => {
      const dir = freshBlankProject();
      pruneTargets(dir, ['cli'], 'basic');
      writeFileSync(join(dir, 'package.json'), text);
      expect(() => addTarget(dir, 'web', 'basic')).toThrow(/package\.json.*must be an object/);
      expect(existsSync(join(dir, 'targets/web'))).toBe(false);
      expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toMatch(/^targets: \[cli\]$/m);
    },
  );

  it('a manifest whose targets list is anchored and aliased: the prune keeps the anchor, and the alias follows the new list', () => {
    const dir = freshBlankProject();
    writeFileSync(join(dir, 'harness.yml'), 'targets: &surfaces [cli, desktop, web]\napp:\n  surfaces: *surfaces\nmodel:\n  llm:\n    id: qwen3.5-4b\n');
    pruneTargets(dir, ['cli'], 'basic');
    expect(existsSync(join(dir, 'targets/web'))).toBe(false);
    expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toContain('targets: &surfaces [cli]\napp:\n  surfaces: *surfaces\n');
  });

  it('addTarget with a DOM target present but no tsconfig.web.json refuses before copying anything', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli', 'desktop'], 'basic');
    rmSync(join(dir, 'tsconfig.web.json'));
    expect(() => addTarget(dir, 'web', 'basic')).toThrow(/tsconfig\.web\.json/);
    expect(existsSync(join(dir, 'targets/web'))).toBe(false);
    expect(pkg(dir).scripts['serve']).toBeUndefined();
  });

  it('addTarget refuses a malformed harness.yml before copying anything', () => {
    const dir = freshBlankProject();
    pruneTargets(dir, ['cli'], 'basic');
    writeFileSync(join(dir, 'harness.yml'), 'targets: [cli\n');
    expect(() => addTarget(dir, 'web', 'basic')).toThrow(/harness\.yml/);
    expect(existsSync(join(dir, 'targets/web'))).toBe(false);
    expect(pkg(dir).scripts['serve']).toBeUndefined();
  });
});

describe('isModelPath', () => {
  it('classifies catalog ids as ids and .gguf/paths as paths', () => {
    // Bare slugs stay ids — even unknown ones, so the picker survives catalog drift.
    expect(isModelPath('qwen3.5-4b')).toBe(false);
    expect(isModelPath('custom-model')).toBe(false);
    // Anything path-shaped is BYO.
    expect(isModelPath('./models/llm/x.gguf')).toBe(true);
    expect(isModelPath('/abs/path/model.gguf')).toBe(true);
    expect(isModelPath('models/llm/x.gguf')).toBe(true);
    expect(isModelPath('bare.gguf')).toBe(true);
    expect(isModelPath('~/models/x.gguf')).toBe(true);
  });
});

describe('applyModelChoice', () => {
  it('rewrites model.llm id + context', () => {
    const dir = freshBlankProject();
    applyModelChoice(dir, { llm: 'custom-model', context: 8192 });
    const yml = readFileSync(join(dir, 'harness.yml'), 'utf8');
    expect(yml).toMatch(/^ {4}id: custom-model$/m);
    expect(yml).toMatch(/context:\s*8192/);
  });

  it('writes a BYO path as `path:` (not `id:`), in the entry’s place', () => {
    const dir = freshBlankProject();
    applyModelChoice(dir, { llm: './models/llm/custom.gguf' });
    const yml = readFileSync(join(dir, 'harness.yml'), 'utf8');
    expect(yml).toMatch(/^ {4}path: \.\/models\/llm\/custom\.gguf$/m);
    // The llm block must NOT still carry an `id:` line — a model entry is id XOR path.
    const llmBlock = yml.slice(yml.indexOf('llm:'), yml.indexOf('context:'));
    expect(llmBlock).not.toMatch(/\bid:/);
    expect(yml).toMatch(/context:\s*32768/); // context left at the template default
  });

  it('a BYO path with backslashes + quotes round-trips — quoting is the library’s', () => {
    const dir = freshBlankProject();
    const weird = 'C:\\models\\my "best".gguf';
    applyModelChoice(dir, { llm: weird });
    expect(readModelField(dir, 'llm')).toEqual({ path: weird });
  });

  it('leaves context untouched when not given', () => {
    const dir = freshBlankProject();
    applyModelChoice(dir, { llm: 'qwen3.5-4b' });
    expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toMatch(/context:\s*32768/);
  });

  it('throws when there is no model: block at all', () => {
    const dir = freshBlankProject();
    writeFileSync(join(dir, 'harness.yml'), 'targets: [cli]\n');
    expect(() => applyModelChoice(dir, { llm: 'x' })).toThrow(/model:/);
  });
});

describe('newCommand.run — non-interactive flag path (end-to-end)', () => {
  it('scaffolds a cli-only basic with a BYO --model path written as `path:`', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'harness-new-'));
    created.push(parent);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await newCommand.run([
      'byoproj',
      '--dir',
      parent,
      '--targets',
      'cli',
      '--model',
      './models/llm/mine.gguf',
      '--skip-abilities',
    ]);
    out.mockRestore();

    expect(code).toBe(0);
    const yml = readFileSync(join(parent, 'byoproj', 'harness.yml'), 'utf8');
    expect(yml).toMatch(/^ {4}path: \.\/models\/llm\/mine\.gguf$/m);
    // cli-only prune landed too — desktop/web are gone.
    expect(existsSync(join(parent, 'byoproj', 'targets/desktop'))).toBe(false);
    expect(existsSync(join(parent, 'byoproj', 'targets/web'))).toBe(false);
    expect(existsSync(join(parent, 'byoproj', 'targets/cli'))).toBe(true);
  });

  it('treats an empty/whitespace --model as not provided (uses the catalog default)', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'harness-new-'));
    created.push(parent);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await newCommand.run([
      'dflt',
      '--dir',
      parent,
      '--targets',
      'cli',
      '--model',
      '   ',
      '--skip-abilities',
    ]);
    out.mockRestore();

    expect(code).toBe(0);
    const yml = readFileSync(join(parent, 'dflt', 'harness.yml'), 'utf8');
    expect(yml).toMatch(/^ {4}id: qwen3\.5-4b$/m); // the catalog default, not an empty value
    expect(yml).not.toMatch(/(id|path):\s*""/);
  });

  it('emits a real .gitignore (the template stores it undotted so npm ships it)', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'harness-new-'));
    created.push(parent);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await newCommand.run(['ign', '--dir', parent, '--targets', 'cli', '--skip-abilities']);
    out.mockRestore();

    expect(code).toBe(0);
    const dir = join(parent, 'ign');
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
    expect(existsSync(join(dir, 'gitignore'))).toBe(false); // the undotted name must not leak
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toMatch(/^node_modules\/$/m);
  });

  it('refuses to scaffold over an existing FILE (not just a directory)', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'harness-new-'));
    created.push(parent);
    writeFileSync(join(parent, 'taken'), 'i am a file, not a directory');
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await newCommand.run(['taken', '--dir', parent, '--yes']);
    err.mockRestore();
    out.mockRestore();
    // Errors cleanly (exit 1) rather than crashing later on mkdirSync EEXIST.
    expect(code).toBe(1);
  });
});

describe('model-catalog (vendored)', () => {
  it('offers the default llm', () => {
    const llms = modelsForRole('llm');
    expect(llms.length).toBeGreaterThan(0);
    expect(llms[0].id).toBe('qwen3.5-4b');
    expect(llms[0].recommendedContext).toBe(32768);
  });

  it('carries a reranker entry too', () => {
    expect(MODEL_CATALOG.some((m) => m.role === 'reranker')).toBe(true);
  });
});
