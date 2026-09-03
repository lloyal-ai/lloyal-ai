/**
 * `link-local` / `unlink-local` — run a harness project (a scaffold, or a
 * template in place) against a LOCAL platform workspace instead of the
 * published packages.
 *
 * The contract is ZERO tracked-file mutation at rest: `package.json` is
 * byte-identical before and after either command. `link-local` removes the
 * platform pins from a TEMPORARY copy of the manifest so `npm install` never
 * tries to resolve them (an unpublished alpha pin would fail), restores the
 * original bytes, then symlinks each platform package straight into
 * `node_modules` — its dependencies resolve up its REAL path into the
 * workspace's own install. The install runs with `--package-lock=false`, so a
 * project that commits its lockfile gets it back untouched too. `unlink-local`
 * deletes `node_modules`; nothing tracked was ever touched, so the tree is
 * pristine by construction.
 *
 * This is what lets `templates/<t>` itself be developed in place: edits land
 * directly on the shipped surface, and nothing the link does can leak into it.
 */
import { parseArgs } from 'node:util';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from '../command.js';
import { spawnNpm } from '../npm-spawn.js';

/**
 * Platform package → its directory, relative to the hdk workspace root.
 * `@lloyal-labs/lloyal.node` lives in its own repo and is resolved separately
 * (`--node`, or a sibling of the workspace).
 */
const WORKSPACE_PACKAGES: Record<string, string> = {
  '@lloyal-labs/sdk': 'packages/sdk',
  '@lloyal-labs/lloyal-agents': 'packages/agents',
  '@lloyal-labs/rig': 'packages/rig',
  '@lloyal-labs/dev-tools': 'packages/dev-tools',
  '@lloyal-labs/media': 'packages/media',
  '@lloyal-labs/binding': 'packages/binding',
  '@lloyal-labs/host': 'packages/host',
  '@lloyal-labs/web-ability': 'packages/abilities/web',
  '@lloyal-labs/corpus-ability': 'packages/abilities/corpus',
};
const NODE_PACKAGE = '@lloyal-labs/lloyal.node';
/** Sibling names probed for the lloyal.node repo when `--node` is not given. */
const NODE_SIBLINGS = ['lloyal-node', 'lloyal.node'];

const LINK_USAGE = [
  'lloyal link-local — run this project against a local platform workspace',
  '',
  'Usage:',
  '  lloyal link-local <hdk-workspace> [--node <lloyal.node-repo>]',
  '',
  'Symlinks every @lloyal-labs package this project uses into node_modules,',
  'pointing at the workspace, and installs everything else normally.',
  'package.json and package-lock.json are byte-identical before and after —',
  'nothing the link does can leak into a committed template or scaffold.',
  '',
  'Works in a scaffolded project or directly inside templates/<name>.',
  'Undo with `lloyal unlink-local`.',
].join('\n');

const UNLINK_USAGE = [
  'lloyal unlink-local — return a link-local project to published packages',
  '',
  'Usage:',
  '  lloyal unlink-local',
  '',
  'Deletes node_modules. Nothing tracked was touched by link-local, so this',
  'restores the pristine tree; the next `npm install` resolves the published',
  'pins again.',
].join('\n');

interface PkgManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [k: string]: unknown;
}

/** Await a spawned npm's exit code (spawnNpm never rejects on non-zero). */
function npmExit(args: string[], cwd: string): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawnNpm(args, { cwd, stdio: 'inherit' });
    child.on('close', (code) => resolveExit(code ?? 1));
    child.on('error', () => resolveExit(1));
  });
}

export const linkLocalCommand: Command = {
  name: 'link-local',
  summary: 'Run this project against a local platform workspace (symlinks, zero manifest mutation)',
  usage: LINK_USAGE,
  async run(argv) {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: {
        help: { type: 'boolean', short: 'h' },
        node: { type: 'string' },
      },
      allowPositionals: true,
    });
    if (values.help) {
      process.stdout.write(`${LINK_USAGE}\n`);
      return 0;
    }

    const projectDir = process.cwd();
    const pkgPath = join(projectDir, 'package.json');
    if (!existsSync(pkgPath)) {
      process.stderr.write('lloyal: no package.json here — run link-local inside a harness project or template.\n');
      return 1;
    }
    const workspace = positionals[0] ? resolve(positionals[0]) : undefined;
    if (!workspace || !existsSync(join(workspace, 'packages'))) {
      process.stderr.write('lloyal: link-local needs the hdk workspace path (a directory containing packages/).\n');
      return 1;
    }
    const nodeRepo = values.node
      ? resolve(values.node)
      : NODE_SIBLINGS.map((n) => join(workspace, '..', n)).find((p) => existsSync(join(p, 'package.json')));

    // The link set: every mapped package this project depends on, plus the
    // ability packages the harness imports when they are not dependencies at
    // all (the template stores no ability deps — `lloyal new` vendors them;
    // in-place development links the workspace's own instead).
    const originalBytes = readFileSync(pkgPath);
    const manifest = JSON.parse(originalBytes.toString()) as PkgManifest;
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    const links: Array<{ name: string; dir: string }> = [];
    for (const [name, rel] of Object.entries(WORKSPACE_PACKAGES)) {
      const dir = join(workspace, rel);
      const isAbility = name.endsWith('-ability');
      const wanted = deps[name] != null ? !String(deps[name]).startsWith('file:vendor/') : isAbility;
      if (wanted && existsSync(join(dir, 'package.json'))) links.push({ name, dir });
    }
    if (deps[NODE_PACKAGE] != null) {
      if (nodeRepo) links.push({ name: NODE_PACKAGE, dir: nodeRepo });
      else process.stderr.write(`lloyal: ${NODE_PACKAGE} not linked — no lloyal.node repo found (pass --node <path>).\n`);
    }
    if (links.length === 0) {
      process.stderr.write('lloyal: nothing to link — no @lloyal-labs dependencies found here.\n');
      return 1;
    }

    // Install everything ELSE with the linked pins removed from a temporary
    // manifest — npm never sees them, so an unpublished pin cannot fail the
    // install. The original bytes are restored no matter what.
    const trimmed = JSON.parse(originalBytes.toString()) as PkgManifest;
    for (const { name } of links) {
      if (trimmed.dependencies) delete trimmed.dependencies[name];
      if (trimmed.devDependencies) delete trimmed.devDependencies[name];
    }
    let installCode: number;
    try {
      writeFileSync(pkgPath, `${JSON.stringify(trimmed, null, 2)}\n`);
      // `--package-lock=false`: npm rewrites a lockfile on every install, and
      // the lockfile is a tracked file in any project that commits one.
      installCode = await npmExit(['install', '--no-audit', '--no-fund', '--package-lock=false'], projectDir);
    } finally {
      writeFileSync(pkgPath, originalBytes);
    }
    if (installCode !== 0) {
      process.stderr.write('lloyal: npm install failed — nothing linked (package.json untouched).\n');
      return installCode;
    }

    // The symlinks themselves — ours, not npm's, so they survive exactly as
    // placed and unlink is a plain delete.
    for (const { name, dir } of links) {
      const linkPath = join(projectDir, 'node_modules', ...name.split('/'));
      mkdirSync(join(linkPath, '..'), { recursive: true });
      rmSync(linkPath, { recursive: true, force: true });
      symlinkSync(dir, linkPath, 'junction');
      const built = existsSync(join(dir, 'dist'));
      process.stdout.write(`  linked ${name} → ${dir}${built ? '' : '  (no dist/ — build it or typecheck runs against stale output)'}\n`);
    }
    process.stdout.write(`linked ${links.length} package(s); package.json untouched. Undo: lloyal unlink-local\n`);
    return 0;
  },
};

export const unlinkLocalCommand: Command = {
  name: 'unlink-local',
  summary: 'Undo link-local — delete node_modules; the tree is pristine by construction',
  usage: UNLINK_USAGE,
  async run(argv) {
    if (argv.includes('--help') || argv.includes('-h')) {
      process.stdout.write(`${UNLINK_USAGE}\n`);
      return 0;
    }
    const projectDir = process.cwd();
    if (!existsSync(join(projectDir, 'package.json'))) {
      process.stderr.write('lloyal: no package.json here — run unlink-local inside a harness project or template.\n');
      return 1;
    }
    rmSync(join(projectDir, 'node_modules'), { recursive: true, force: true });
    process.stdout.write('unlinked — node_modules removed; `npm install` resolves the published pins again.\n');
    return 0;
  },
};
