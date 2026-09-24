import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  cpSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { writeModelField, readModelField } from '../src/scaffold/apply-model.js';
import { readProjectMarker } from '../src/scaffold/write-marker.js';
import { DEFAULT_ABILITIES } from '../src/commands/new.js';
import { presentTargets } from '../src/scaffold/add-target.js';
import { newCommand } from '../src/commands/new.js';
import {
  modelsUseCommand,
  modelsAddCommand,
  modelsDownloadCommand,
  modelsListCommand,
} from '../src/commands/models.js';
import { targetsAddCommand, targetsRemoveCommand, targetsListCommand } from '../src/commands/targets.js';

const BASIC_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'basic');

const created: string[] = [];
function freshBlankTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mt-tree-'));
  cpSync(BASIC_TEMPLATE, dir, { recursive: true });
  created.push(dir);
  return dir;
}

/**
 * Scaffold a real project (template copied, pruned, model + marker written).
 * `--skip-abilities` keeps this hermetic — `new` otherwise fetches the template's
 * default AgentApps from apps.lloyal.ai, which these tests neither need nor
 * should depend on.
 */
async function scaffold(name: string, targets: string, template = 'basic'): Promise<string> {
  const parent = mkdtempSync(join(tmpdir(), 'mt-proj-'));
  created.push(parent);
  const code = await newCommand.run([
    name,
    '--dir',
    parent,
    '--template',
    template,
    '--targets',
    targets,
    '--model',
    'qwen3.5-4b',
    '--skip-abilities',
    '--yes',
  ]);
  expect(code).toBe(0);
  return join(parent, name);
}

/** Run a command with cwd temporarily set to `dir` (the in-project verbs read cwd). */
async function runIn(dir: string, fn: () => Promise<number>): Promise<number> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

function pkg(dir: string): {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  main?: string;
  harnessdev?: { template: string; targets: string[]; abilities?: string[] };
} {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

beforeEach(() => {
  // Silence command chatter; individual tests re-spy when they assert on output.
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('writeModelField / readModelField', () => {
  it('rewrites the llm id in place', () => {
    const dir = freshBlankTree();
    writeModelField(dir, 'llm', { id: 'other-4b' });
    const yml = readFileSync(join(dir, 'harness.yml'), 'utf8');
    expect(yml).toMatch(/^ {4}id: other-4b$/m);
    expect(readModelField(dir, 'llm')).toEqual({ id: 'other-4b' });
  });

  /**
   * The three ways the SAME document can be spelled. The line reader this
   * replaced matched only `id: "…"` — a double-quoted value in a block map — so
   * it reported the other two as unset and, on write, appended a second `id:`
   * beside the one it could not see. Nothing in the suite covered them, because
   * the suite was written against what that reader could do.
   */
  const SPELLINGS: ReadonlyArray<readonly [string, string]> = [
    ['inline flow', 'model:\n  llm: { id: "qwen3.5-4b", context: 32768 }\n'],
    ['unquoted', 'model:\n  llm:\n    id: qwen3.5-4b\n    context: 32768\n'],
    ['single-quoted', "model:\n  llm:\n    id: 'qwen3.5-4b'\n    context: 32768\n"],
  ];

  for (const [label, yml] of SPELLINGS) {
    it(`reads a model spelled ${label}`, () => {
      const dir = freshBlankTree();
      writeFileSync(join(dir, 'harness.yml'), yml);
      expect(readModelField(dir, 'llm')).toEqual({ id: 'qwen3.5-4b' });
    });

    it(`rewrites a model spelled ${label} in place, never duplicating the key`, () => {
      const dir = freshBlankTree();
      writeFileSync(join(dir, 'harness.yml'), yml);
      writeModelField(dir, 'llm', { id: 'other-4b' });
      expect(readModelField(dir, 'llm')).toEqual({ id: 'other-4b' });
      const text = readFileSync(join(dir, 'harness.yml'), 'utf8');
      expect((text.match(/\bid:/g) ?? []).length).toBe(1);
    });
  }

  it('swaps the llm key id <-> path (an entry is id XOR path), keeping the entry above context:', () => {
    const dir = freshBlankTree();
    writeModelField(dir, 'llm', { path: './models/llm/x.gguf' });
    let llm = sliceLlm(dir);
    expect(llm).toMatch(/path: \.\/models\/llm\/x\.gguf/);
    expect(llm).not.toMatch(/\bid:/);
    writeModelField(dir, 'llm', { id: 'back-to-id' });
    llm = sliceLlm(dir);
    expect(llm).toMatch(/id: back-to-id/);
    expect(llm).not.toMatch(/\bpath:/);
  });

  it('a manifest carrying BOTH id and path: the requested key wins, the other goes', () => {
    const dir = freshBlankTree();
    writeFileSync(
      join(dir, 'harness.yml'),
      'model:\n  llm:\n    id: "a"\n    path: "/tmp/a.gguf"\n    context: 32768\n',
    );
    writeModelField(dir, 'llm', { id: 'other' });
    expect(readModelField(dir, 'llm')).toEqual({ id: 'other' });
    const text = readFileSync(join(dir, 'harness.yml'), 'utf8');
    expect((text.match(/\bid:/g) ?? []).length).toBe(1);
    expect(text).not.toMatch(/\bpath:/);
  });

  it('creates a reranker block when the template has none', () => {
    const dir = freshBlankTree();
    expect(readModelField(dir, 'reranker')).toBeNull();
    writeModelField(dir, 'reranker', { id: 'qwen3-reranker-0.6b-q8' });
    expect(readModelField(dir, 'reranker')).toEqual({ id: 'qwen3-reranker-0.6b-q8' });
    const yml = readFileSync(join(dir, 'harness.yml'), 'utf8');
    expect(yml).toMatch(/^ {2}reranker:\n {4}id: qwen3-reranker-0\.6b-q8$/m);
  });

  it('rewrites an already-live reranker block in place (no duplicate)', () => {
    const dir = freshBlankTree();
    writeModelField(dir, 'reranker', { id: 'first' });
    writeModelField(dir, 'reranker', { path: './models/reranker/r.gguf' });
    expect(readModelField(dir, 'reranker')).toEqual({ path: './models/reranker/r.gguf' });
    const liveReranker = (readFileSync(join(dir, 'harness.yml'), 'utf8').match(/^ {2}reranker:$/gm) ?? []).length;
    expect(liveReranker).toBe(1); // exactly one live block, not two
  });

  it('round-trips a value with an embedded quote through write -> read', () => {
    const dir = freshBlankTree();
    const weird = 'C:\\models\\my "best".gguf';
    writeModelField(dir, 'llm', { path: weird });
    // readModelField must return the REAL value, not truncated at the first \".
    expect(readModelField(dir, 'llm')).toEqual({ path: weird });
    // Re-writing OVER the escaped value must not corrupt it (one clean entry).
    writeModelField(dir, 'llm', { id: 'clean-id' });
    expect(readModelField(dir, 'llm')).toEqual({ id: 'clean-id' });
    const yml = readFileSync(join(dir, 'harness.yml'), 'utf8');
    expect((yml.match(/^ {2}llm:$/gm) ?? []).length).toBe(1);
    expect(yml).not.toContain('.gguf"".gguf'); // no dangling remnant
  });

  it('throws when there is no model: block', () => {
    const dir = freshBlankTree();
    writeFileSync(join(dir, 'harness.yml'), 'targets: [cli]\n');
    expect(() => writeModelField(dir, 'llm', { id: 'x' })).toThrow(/model:/);
  });
});

describe('models: verbs', () => {
  it('models:use writes id; rejects a path-shaped arg', async () => {
    const dir = await scaffold('u1', 'cli');
    expect(await runIn(dir, () => modelsUseCommand.run(['qwen3.5-4b']))).toBe(0);
    expect(readModelField(dir, 'llm')).toEqual({ id: 'qwen3.5-4b' });
    // A path belongs to models:add, not models:use.
    expect(await runIn(dir, () => modelsUseCommand.run(['./x.gguf']))).toBe(1);
  });

  it('models:add writes a path (BYO) for the given role', async () => {
    const dir = await scaffold('a1', 'cli');
    expect(await runIn(dir, () => modelsAddCommand.run(['./models/reranker/r.gguf', '--role', 'reranker']))).toBe(0);
    expect(readModelField(dir, 'reranker')).toEqual({ path: './models/reranker/r.gguf' });
  });

  it('models:list runs read-only and reports catalog + active', async () => {
    const dir = await scaffold('l1', 'cli');
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true));
    expect(await runIn(dir, () => modelsListCommand.run([]))).toBe(0);
    const text = out.join('');
    expect(text).toContain('qwen3.5-4b');
    expect(text).toMatch(/llm\s+id: qwen3.5-4b/);
  });

  it('rejects an unknown --role', async () => {
    const dir = await scaffold('r1', 'cli');
    expect(await runIn(dir, () => modelsUseCommand.run(['x', '--role', 'bogus']))).toBe(1);
  });

  it('fails when not run from a harness project', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'mt-empty-'));
    created.push(empty);
    expect(await runIn(empty, () => modelsListCommand.run([]))).toBe(1);
  });
});

describe('models:download (streaming fetch, mocked)', () => {
  const URL = 'https://example.com/weights/my-model.gguf';
  const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  function mockFetch(res: () => Response): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res()),
    );
  }

  it('streams to models/<role>/<file>.gguf and pins model.<role>.path', async () => {
    const dir = await scaffold('d1', 'cli');
    mockFetch(() => new Response(BYTES, { headers: { 'content-length': String(BYTES.length) } }));
    expect(await runIn(dir, () => modelsDownloadCommand.run([URL, '--role', 'reranker']))).toBe(0);
    const dest = join(dir, 'models', 'reranker', 'my-model.gguf');
    expect(existsSync(dest)).toBe(true);
    expect(new Uint8Array(readFileSync(dest))).toEqual(BYTES);
    expect(readModelField(dir, 'reranker')).toEqual({ path: './models/reranker/my-model.gguf' });
  });

  it('--sha256 verifies and fail-closes (deletes the file) on mismatch', async () => {
    const dir = await scaffold('d2', 'cli');
    mockFetch(() => new Response(BYTES));
    const code = await runIn(dir, () => modelsDownloadCommand.run([URL, '--sha256', 'deadbeef']));
    expect(code).toBe(1);
    expect(existsSync(join(dir, 'models', 'llm', 'my-model.gguf'))).toBe(false); // rolled back
  });

  it('--sha256 accepts a matching digest', async () => {
    const dir = await scaffold('d3', 'cli');
    const sha = createHash('sha256').update(BYTES).digest('hex');
    mockFetch(() => new Response(BYTES));
    expect(await runIn(dir, () => modelsDownloadCommand.run([URL, '--sha256', sha]))).toBe(0);
    expect(existsSync(join(dir, 'models', 'llm', 'my-model.gguf'))).toBe(true);
  });

  it('errors (no file) when the response is not ok', async () => {
    const dir = await scaffold('d4', 'cli');
    mockFetch(() => new Response('nope', { status: 404 }));
    expect(await runIn(dir, () => modelsDownloadCommand.run([URL]))).toBe(1);
    expect(existsSync(join(dir, 'models', 'llm', 'my-model.gguf'))).toBe(false);
  });
});

describe('targets:add (inverse of prune)', () => {
  it('adds web to a cli-only project: dir, bin, deps, tsconfig, scripts, marker', async () => {
    const dir = await scaffold('t1', 'cli');
    expect(existsSync(join(dir, 'tsconfig.web.json'))).toBe(false); // pruned
    expect(await runIn(dir, () => targetsAddCommand.run(['web']))).toBe(0);

    expect(existsSync(join(dir, 'targets/web/serve.ts'))).toBe(true);
    expect(existsSync(join(dir, 'bin/serve.js'))).toBe(true);
    const p = pkg(dir);
    expect(p.scripts.serve).toBeDefined();
    expect(p.scripts.typecheck).toBe('tsc --noEmit && tsc -p tsconfig.web.json');
    // Restored tsconfig.web.json holds ONLY harness/* + web/* (no desktop).
    const web = readFileSync(join(dir, 'tsconfig.web.json'), 'utf8');
    expect(web).toContain('targets/web/main.tsx');
    expect(web).not.toContain('targets/desktop');
    expect(readFileSync(join(dir, 'harness.yml'), 'utf8')).toMatch(/^targets: \[cli, web\]$/m);
    expect(p.harnessdev?.targets).toEqual(['cli', 'web']);
  });

  it('adding a second DOM target (desktop) restores electron config + typecheck', async () => {
    const dir = await scaffold('t2', 'cli,web');
    expect(await runIn(dir, () => targetsAddCommand.run(['desktop']))).toBe(0);
    expect(existsSync(join(dir, 'tsconfig.electron.json'))).toBe(true);
    expect(existsSync(join(dir, 'electron.vite.config.ts'))).toBe(true);
    const p = pkg(dir);
    expect(p.devDependencies?.electron).toBeDefined();
    expect(p.scripts.typecheck).toBe('tsc --noEmit && tsc -p tsconfig.web.json && tsc -p tsconfig.electron.json');
  });

  it('errors if the target is already present', async () => {
    const dir = await scaffold('t3', 'cli,web');
    expect(await runIn(dir, () => targetsAddCommand.run(['web']))).toBe(1);
  });

  it('errors on cli (mandatory) and on a missing marker', async () => {
    const dir = await scaffold('t4', 'cli');
    expect(await runIn(dir, () => targetsAddCommand.run(['cli']))).toBe(1);
    // Strip the marker → add can't tell which template to copy from.
    const p = pkg(dir) as Record<string, unknown>;
    delete p.harnessdev;
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(p, null, 2)}\n`);
    expect(await runIn(dir, () => targetsAddCommand.run(['web']))).toBe(1);
  });

  it('restores desktop’s `main` entry point + electron guard on add', async () => {
    const dir = await scaffold('t6', 'cli'); // cli-only: prune dropped all three
    expect(pkg(dir).main).toBeUndefined();
    expect(await runIn(dir, () => targetsAddCommand.run(['desktop']))).toBe(0);
    // Without `main`, electron-vite refuses to launch the added surface.
    expect(pkg(dir).main).toBe('out/main/main.js');
    expect(pkg(dir).scripts['prebuild:desktop']).toContain('node bin/ensure-electron.js');
    expect(existsSync(join(dir, 'bin/ensure-electron.js'))).toBe(true);
  });

  it('the shared view survives losing ONE DOM target, and returns with the first one back', async () => {
    // The mutation path no scaffold covers. `targets:remove desktop` used to
    // delete the React view out from under a WORKING web build — the sharpest
    // form of this bug, because nothing about it looks destructive.
    const shared = 'src/ui/App.tsx';
    const include = (d: string): string[] =>
      JSON.parse(readFileSync(join(d, 'tsconfig.web.json'), 'utf8').replace(/\/\/.*/g, '')).include;
    const exclude = (d: string): string[] =>
      JSON.parse(readFileSync(join(d, 'tsconfig.json'), 'utf8').replace(/\/\/.*/g, '')).exclude;

    const dir = await scaffold('t7', 'cli,desktop,web');
    expect(existsSync(join(dir, shared))).toBe(true);

    // 1. Drop desktop — web still mounts the view, so it must stay.
    expect(await runIn(dir, () => targetsRemoveCommand.run(['desktop', '--yes']))).toBe(0);
    expect(existsSync(join(dir, shared))).toBe(true);
    expect(include(dir)).toContain('src/ui/**/*');

    // 2. Drop web too — the view STAYS. It sits under `src/ui/` beside the state
    // the terminal view folds, so nothing there belongs to the DOM targets alone;
    // a cli-only project carries it unused rather than splitting the directory.
    expect(await runIn(dir, () => targetsRemoveCommand.run(['web', '--yes']))).toBe(0);
    expect(existsSync(join(dir, shared))).toBe(true);
    // The Node build must still refuse to compile it, or `tsc` meets React.
    expect(exclude(dir)).toContain('src/ui/App.tsx');

    // 3. Add web back — the web tsconfig returns and covers the view again.
    expect(await runIn(dir, () => targetsAddCommand.run(['web']))).toBe(0);
    expect(existsSync(join(dir, shared))).toBe(true);
    expect(include(dir)).toContain('src/ui/**/*');
  });

  it('refuses an OLD cli-only project too — it has no `_shared` to give it away', async () => {
    // The regression the DOM-target early return allowed: a cli-only project
    // mounts no view under `targets/`, so the guard skipped it entirely — and
    // `targets:add web` then wrote entries importing `src/app.ts` and `src/ui/`
    // into a project with neither, reporting success.
    const dir = await scaffold('t9', 'cli');
    rmSync(join(dir, 'src'), { recursive: true, force: true });

    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await runIn(dir, () => targetsAddCommand.run(['web']))).toBe(1);
    const said = err.mock.calls.map((c) => String(c[0])).join('');
    err.mockRestore();

    expect(said).toMatch(/src\/ui/);
    expect(existsSync(join(dir, 'targets/web'))).toBe(false); // nothing written
  });

  it('refuses a project whose view predates the move, without touching it', async () => {
    // A clean break with no migration — but breaking loudly and breaking silently
    // are different. Both templates now keep the view under `src/ui/`; a project
    // scaffolded before that still carries `targets/_shared/`, and targets:add
    // would write entries for a layout it does not have and report SUCCESS.
    const dir = await scaffold('t8', 'cli,desktop');
    // Rewind to the old shape: the view back under `targets/`, no `src/`.
    cpSync(join(dir, 'src/ui'), join(dir, 'targets/_shared'), { recursive: true });
    rmSync(join(dir, 'src'), { recursive: true, force: true });

    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await runIn(dir, () => targetsAddCommand.run(['web']))).toBe(1);
    const said = err.mock.calls.map((c) => String(c[0])).join('');
    err.mockRestore();

    expect(said).toMatch(/src\/ui/);
    expect(said).toMatch(/targets\/_shared/);
    expect(existsSync(join(dir, 'targets/web'))).toBe(false); // nothing written
    expect(existsSync(join(dir, 'targets/desktop'))).toBe(true); // nothing destroyed
  });

  it('folds the ORIGINATING template (research web is research’s, not basic’s)', async () => {
    const dir = await scaffold('t5', 'cli,desktop,web', 'research');
    await runIn(dir, () => targetsRemoveCommand.run(['web', '--yes']));
    expect(await runIn(dir, () => targetsAddCommand.run(['web']))).toBe(0);
    // research's web serve.ts is byte-identical to the research template's.
    const restored = readFileSync(join(dir, 'targets/web/serve.ts'), 'utf8');
    const tpl = readFileSync(join(BASIC_TEMPLATE, '..', 'research', 'targets/web/serve.ts'), 'utf8')
      .split('__NAME__')
      .join('t5');
    expect(restored).toBe(tpl);
    expect(readProjectMarker(dir)?.template).toBe('research');
  });
});

describe('targets:remove + round-trip', () => {
  it('remove web wraps prune + updates the marker', async () => {
    const dir = await scaffold('rm1', 'cli,desktop,web');
    expect(await runIn(dir, () => targetsRemoveCommand.run(['web', '--yes']))).toBe(0);
    expect(existsSync(join(dir, 'targets/web'))).toBe(false);
    expect(existsSync(join(dir, 'bin/serve.js'))).toBe(false);
    expect(pkg(dir).dependencies?.['@lloyal-labs/host']).toBeUndefined();
    expect(pkg(dir).harnessdev?.targets).toEqual(['cli', 'desktop']);
  });

  it('refuses to remove cli, and errors when the target is absent', async () => {
    const dir = await scaffold('rm2', 'cli,web');
    expect(await runIn(dir, () => targetsRemoveCommand.run(['cli', '--yes']))).toBe(1);
    expect(await runIn(dir, () => targetsRemoveCommand.run(['desktop', '--yes']))).toBe(1); // not present
  });

  it('does not fabricate a template marker for a pre-marker project', async () => {
    const dir = await scaffold('rm4', 'cli,web');
    // Simulate a pre-0.6.0 / hand-made project: strip the marker.
    const p = pkg(dir) as Record<string, unknown>;
    delete p.harnessdev;
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(p, null, 2)}\n`);
    expect(await runIn(dir, () => targetsRemoveCommand.run(['web', '--yes']))).toBe(0);
    expect(readProjectMarker(dir)).toBeNull(); // no guessed `template: basic`
  });

  it('refuses without --yes in a non-interactive shell', async () => {
    const dir = await scaffold('rm3', 'cli,web');
    const wasTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      expect(await runIn(dir, () => targetsRemoveCommand.run(['web']))).toBe(1);
      expect(existsSync(join(dir, 'targets/web'))).toBe(true); // nothing removed
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: wasTTY, configurable: true });
    }
  });

  it('remove → add web reproduces every web dep, script, and file', async () => {
    const dir = await scaffold('rt1', 'cli,desktop,web');
    await runIn(dir, () => targetsRemoveCommand.run(['web', '--yes']));
    expect(await runIn(dir, () => targetsAddCommand.run(['web']))).toBe(0);
    const p = pkg(dir);
    expect(p.devDependencies?.['@types/ws']).toBeDefined();
    for (const s of ['serve', 'dev:web', 'build:web']) expect(p.scripts[s]).toBeDefined();
    expect(existsSync(join(dir, 'targets/web/serve.ts'))).toBe(true);
    expect(existsSync(join(dir, 'bin/serve.js'))).toBe(true);
    expect(presentTargets(dir)).toEqual(['cli', 'desktop', 'web']);
  });
});

describe('targets:list', () => {
  it('shows present + absent surfaces and the template', async () => {
    const dir = await scaffold('ls1', 'cli,web');
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true));
    expect(await runIn(dir, () => targetsListCommand.run([]))).toBe(0);
    const text = out.join('');
    expect(text).toContain('template: basic');
    expect(text).toMatch(/● cli/);
    expect(text).toMatch(/● web/);
    expect(text).toMatch(/○ desktop/);
  });
});

describe('marker', () => {
  it('new stamps harnessdev { template, targets, abilities }', async () => {
    const dir = await scaffold('mk1', 'cli,web', 'basic');
    expect(pkg(dir).harnessdev).toEqual({
      template: 'basic',
      targets: ['cli', 'web'],
      // Recorded even under --skip-abilities: the harness still imports them, so
      // `bin/run.js` needs the specs to name at boot. Read from the source, not
      // copied: the numbers move with every ability release.
      abilities: DEFAULT_ABILITIES.basic,
    });
  });

  it('a targets: verb carries `abilities` through untouched', async () => {
    const dir = await scaffold('mk2', 'cli,web', 'basic');
    expect(await runIn(dir, () => targetsRemoveCommand.run(['web', '--yes']))).toBe(0);
    expect(pkg(dir).harnessdev).toEqual({
      template: 'basic',
      targets: ['cli'],
      abilities: DEFAULT_ABILITIES.basic,
    });
  });
});

function sliceLlm(dir: string): string {
  const yml = readFileSync(join(dir, 'harness.yml'), 'utf8');
  return yml.slice(yml.indexOf('llm:'), yml.indexOf('context:'));
}
