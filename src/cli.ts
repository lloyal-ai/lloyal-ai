#!/usr/bin/env node
/**
 * `lloyal` — the Harness Development Kit CLI.
 *
 * Thin dispatcher. The first token selects a command by name (`new`,
 * `ability:new`, `install`, …); an unknown token is an ERROR, never a silent
 * scaffold. Scaffolding a harness is the explicit `new` verb.
 * Global `--help` / `--version` are handled here; all other flag parsing
 * belongs to the individual command.
 *
 * The package and the bin share the name `lloyal`, so the
 * invocation is identical whether run via `lloyal …` or as the
 * globally-installed `lloyal …` command.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCommand } from './commands/index.js';

function version(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

function printHelp(): void {
  process.stdout.write(
    [
      'lloyal — Harness Development Kit CLI',
      '',
      '  npx lloyal-ai <command>     run it without installing',
      '  npm i -g lloyal-ai          then the command is just `lloyal`',
      '',
      'Scaffold:',
      '  lloyal new [name]           Scaffold a new harness (interactive if no name)',
      '  lloyal new --template research       Start from the tuned research template',
      '  lloyal ability:new <name>       Scaffold a new ability',
      '',
      'Manage models (in a project):',
      '  lloyal models:use <id> [--role llm|reranker]   Pin a catalog model',
      '  lloyal models:add <path> [--role]              Register a local .gguf (BYO)',
      '  lloyal models:download <url> [--role] [--sha256 <hex>]  Fetch a .gguf by URL',
      '  lloyal models:list          Catalog ids, active pins, installed files',
      '',
      'Manage targets (run surfaces, in a project):',
      '  lloyal targets:add <desktop|web>      Add a surface back',
      '  lloyal targets:remove <desktop|web>   Remove a surface',
      '  lloyal targets:list         Show the surfaces present',
      '',
      'Manage backends (in a project, linux-x64 with an NVIDIA GPU):',
      '  lloyal backends:install [--yes]   Install the signed CUDA backend pack, once per box',
      '',
      'Abilities + channel:',
      '  lloyal install <pub>/<name>[@<semver>]   Install a signed ability from apps.lloyal.ai',
      '  lloyal publish              Submit an ability for review + signing',
      '  lloyal publish status <id>  Check the status of a submission',
      '  lloyal publishers register  Claim a publisher handle + attest ToS',
      '  lloyal publishers me        Show your publisher record',
      '  lloyal review <subcommand>  Lloyal-internal review surface',
      '',
      'Options:',
      '  -h, --help     Show this help',
      '  -v, --version  Print the version',
      '',
      'Run `lloyal <command> --help` for command-specific options.',
      '',
    ].join('\n'),
  );
}

export async function main(argv: readonly string[]): Promise<number> {
  const [first, ...rest] = argv;

  if (first === '--version' || first === '-v') {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    printHelp();
    return 0;
  }

  const named = findCommand(first);
  if (named) {
    return named.run(rest);
  }

  // Unknown command → error, NOT a silent scaffold. Scaffolding now requires the
  // explicit `new` verb (a bare `lloyal my-harness` used to make a
  // directory, so a mistyped subcommand silently scaffolded one).
  const suggestion = first.startsWith('-') ? '' : ` Did you mean \`lloyal new ${first}\`?`;
  process.stderr.write(
    `lloyal: unknown command "${first}".${suggestion} Run \`lloyal --help\` for usage.\n`,
  );
  return 1;
}

/**
 * Process entrypoint — turn argv into an exit code. Called by the `bin/run.js`
 * shim, which is the CLI's only executable. Keeping this here (not in the shim)
 * means all logic and its types live in one place and the shim stays a dumb
 * loader; keeping it OFF module top-level means importing `cli.ts` (from a test,
 * say) has no side effects. `main` stays pure — it returns a code — while `run`
 * owns the process glue.
 */
export async function run(): Promise<void> {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
