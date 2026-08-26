import { parseArgs } from 'node:util';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from '../command.js';
import { pruneTargets, type Target } from '../scaffold/prune-targets.js';
import { applyModelChoice } from '../scaffold/apply-model.js';
import { MODEL_CATALOG, modelsForRole } from '../scaffold/model-catalog.js';
import {
  resolveTemplateDir,
  copyTreeWithSubstitutions,
  buildSubstitutions,
} from '../scaffold/copy-tree.js';
import { writeProjectMarker } from '../scaffold/write-marker.js';
import { runInstall, printNextSteps, writeReadmeRunSteps } from '../scaffold/post-scaffold.js';
import { verifyAndVendorAbility, parseAbilitySpec } from '../scaffold/vendor-ability.js';
import { runNewWizard, type TemplateKind, type WizardPrefill } from './new-wizard.js';

const USAGE = [
  'lloyal new — scaffold a new harness project',
  '',
  'Usage:',
  '  lloyal new                         Interactive: name → targets → model → template',
  '  lloyal new <name> [options]        Non-interactive (flags below)',
  '',
  'Arguments:',
  '  <name>        Harness project name — also the directory created. Omit it in a',
  '                terminal to launch the interactive picker.',
  '',
  'Options:',
  '  --template <basic|research>',
  '                Starting point (default: basic). basic = a Wikipedia research',
  '                harness (2-agent pipeline + article UI); research = the tuned',
  '                recon→plan→agents→synth pipeline (grounded multi-agent research).',
  '  --targets <list>',
  '                Comma-separated run surfaces to keep (default: cli,desktop,web).',
  '                cli is always included; the rest are pruned from the scaffold.',
  '  --model <id|path>',
  '                Trunk model — a catalog id (fetched + digest-verified) or a path',
  '                to a local .gguf you already have. Default: the catalog default.',
  '  --dir <path>  Parent directory to create the harness in (default: cwd)',
  '  --skip-install',
  '                Do not run `npm install` after scaffolding (it runs by',
  '                default in an interactive terminal).',
  '  --skip-abilities   Do not fetch the template\'s default Ability(s). The scaffold',
  '                then does NOT typecheck or run until you add them with',
  '                `lloyal install <spec>` — use it only for an offline',
  '                or hermetic scaffold.',
  '  -y, --yes     Skip the picker; accept defaults for anything not given a flag.',
  '  -h, --help    Show this help',
  '',
  'Any flags you pass also pre-seed the picker, so it prompts only for what is',
  'missing. Emits a runnable harness on the selected surfaces, on a resident model',
  '(fetched + verified on first run — no API key), then prints how to run each one.',
].join('\n');

// Same grammar as `lloyal ability:new`: identifier-safe lowercase that
// satisfies both directory and npm package-name conventions.
const NAME_RE = /^[a-z][a-z0-9_-]{1,63}$/;
const ALL_TARGETS: Target[] = ['cli', 'desktop', 'web'];

/**
 * The signed Ability(s) each template runs by default, as `lloyal install`
 * specs (pinned for reproducibility). `new` fetches + Ed25519-verifies these and
 * vendors them as local `file:` deps — the SAME verified path as an explicitly
 * added ability. The ability is NOT a remote-URL npm dependency in the template
 * package.json (npm 12 blocks those, and a plain dep would skip verification);
 * it is written into package.json only after it is verified + vendored here.
 *
 * These are NOT optional extras: each template's `harness/harness.ts` imports
 * these packages at the top level and lists their factories in `export const
 * abilities`. A scaffold without them does not typecheck (TS2307) and cannot boot
 * (ERR_MODULE_NOT_FOUND) — so vendoring is gated ONLY on the explicit
 * `--skip-abilities` escape hatch, never on `--skip-install` or on being a TTY.
 */
export const DEFAULT_ABILITIES: Record<TemplateKind, string[]> = {
  basic: ['lloyal/wikipedia@2.0.0'],
  research: ['lloyal/corpus@2.0.1', 'lloyal/web@2.0.1'],
};

interface ScaffoldPlan {
  name: string;
  template: TemplateKind;
  targets: Target[];
  /** Catalog id OR a BYO `.gguf` path (see `applyModelChoice`). */
  llm: string;
}

/** Flags shared by both paths — undefined means "not provided" (ask / default). */
type Flags = WizardPrefill;

export const newCommand: Command = {
  name: 'new',
  summary: 'Scaffold a new harness (interactive when run without a name)',
  usage: USAGE,
  async run(argv) {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: {
        help: { type: 'boolean', short: 'h' },
        dir: { type: 'string' },
        template: { type: 'string' },
        targets: { type: 'string' },
        model: { type: 'string' },
        'skip-install': { type: 'boolean' },
        'skip-abilities': { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
      },
      allowPositionals: true,
    });

    if (values.help) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }

    const parentDir = resolve(values.dir ?? process.cwd());
    const name = positionals[0];

    // Validate any flags once — they seed BOTH the wizard (as a prefill) and the
    // non-interactive plan (with defaults filled in).
    const flags = validateFlags(values);
    if ('error' in flags) {
      process.stderr.write(`${flags.error}\n`);
      return 1;
    }

    // Interactive picker: a bare `lloyal new` in a real terminal. A provided
    // name, `--yes`, or a non-TTY (CI, or stdin/stdout redirected) takes the flag
    // path below — Ink needs BOTH stdin and stdout to be a TTY, else its
    // keyboard/render UX is broken (piped output would get ANSI garbage). Any
    // flags already given pre-seed the picker so it asks only for the rest.
    const interactive =
      !name && !values.yes && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
    let plan: ScaffoldPlan;
    if (interactive) {
      const result = await runNewWizard(flags);
      if (!result) {
        process.stderr.write('cancelled.\n');
        return 1;
      }
      plan = result;
    } else {
      const built = planFromFlags(name, flags);
      if ('error' in built) {
        process.stderr.write(`${built.error}\n`);
        if (built.usage) process.stderr.write(`\n${USAGE}\n`);
        return 1;
      }
      plan = built;
    }

    // Auto-install by default in a real terminal (the batteries-included flow):
    // scaffolding a project the user can't run yet is a dead-end. Skipped in
    // non-TTY (CI installs itself) or with --skip-install.
    const install = Boolean(process.stdout.isTTY) && !values['skip-install'];
    // Vendoring the template's default abilities is a SEPARATE decision from running
    // `npm install`. The template's harness.ts imports them at the top level, so
    // skipping them emits a project that cannot typecheck or boot — that must
    // never be an implicit consequence of a pipe, of CI, or of --skip-install.
    // Only the explicit --skip-abilities opts out.
    const vendorAbilities = !values['skip-abilities'];
    return performScaffold(plan, parentDir, { install, vendorAbilities });
  },
};

/** Validate provided flags without filling defaults (undefined = ask/default). */
function validateFlags(values: {
  template?: string;
  targets?: string;
  model?: string;
}): Flags | { error: string } {
  let template: TemplateKind | undefined;
  if (values.template != null) {
    if (values.template !== 'basic' && values.template !== 'research') {
      return { error: `lloyal: invalid --template "${values.template}" — expected "basic" or "research".` };
    }
    template = values.template;
  }

  let targets: Target[] | undefined;
  if (values.targets != null) {
    const parsed = parseTargets(values.targets);
    if ('error' in parsed) return { error: `lloyal: ${parsed.error}` };
    targets = parsed.targets;
  }

  // Trim `--model`; an empty/whitespace value is "not provided" (falls to the
  // catalog default) — `??` alone would treat `""` as a real id and write an
  // empty `model.llm`, breaking resolution.
  const llm = values.model?.trim();
  return { template, targets, llm: llm || undefined };
}

/** Build a scaffold plan from CLI flags (the non-interactive path). */
function planFromFlags(
  name: string | undefined,
  flags: Flags,
): ScaffoldPlan | { error: string; usage?: boolean } {
  if (!name) {
    return { error: 'lloyal: missing harness <name>', usage: true };
  }
  if (!NAME_RE.test(name)) {
    return { error: `lloyal: invalid <name> "${name}" — expected [a-z][a-z0-9_-]{1,63}.` };
  }

  return {
    name,
    template: flags.template ?? 'basic',
    targets: flags.targets ?? [...ALL_TARGETS],
    llm: flags.llm ?? modelsForRole('llm')[0]?.id ?? 'qwen3.5-4b',
  };
}

/** Parse a `--targets cli,web` list; cli is always retained. */
function parseTargets(csv: string | undefined): { targets: Target[] } | { error: string } {
  if (!csv) return { targets: [...ALL_TARGETS] };
  const parts = csv.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = parts.filter((p) => !ALL_TARGETS.includes(p as Target));
  if (bad.length) {
    return { error: `unknown --targets value(s): ${bad.join(', ')} — expected cli, desktop, web` };
  }
  const set = new Set(parts as Target[]);
  set.add('cli');
  return { targets: ALL_TARGETS.filter((t) => set.has(t)) };
}

/** Copy the template, prune to the selected targets, write the model, then install + report. */
async function performScaffold(
  plan: ScaffoldPlan,
  parentDir: string,
  opts: { install: boolean; vendorAbilities: boolean },
): Promise<number> {
  const dest = join(parentDir, plan.name);

  // Refuse to clobber ANY existing path (dir, file, or symlink) — falling
  // through would fail later with a cryptic mkdirSync EEXIST/ENOTDIR. Only a
  // missing path (ENOENT) is safe; any other stat error is surfaced, not eaten.
  try {
    statSync(dest);
    process.stderr.write(
      `lloyal: ${dest} already exists. Choose a different name or remove it first.\n`,
    );
    return 1;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      process.stderr.write(
        `lloyal: cannot access ${dest}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 1;
    }
    // ENOENT — the destination is free.
  }

  const defaultAbilities = DEFAULT_ABILITIES[plan.template] ?? [];

  const templateDir = resolveTemplateDir(plan.template);
  try {
    copyTreeWithSubstitutions(templateDir, dest, buildSubstitutions(plan.name));
    if (plan.targets.length < ALL_TARGETS.length) {
      pruneTargets(dest, plan.targets);
    }
    const recommendedContext = MODEL_CATALOG.find(
      (m) => m.role === 'llm' && m.id === plan.llm,
    )?.recommendedContext;
    applyModelChoice(dest, { llm: plan.llm, context: recommendedContext });
    // Provenance: record which template + surfaces this project came from so
    // `targets:add` knows which template's target subtree to copy back, and
    // which ability specs the harness needs so `bin/run.js` can name them if one is
    // missing at boot.
    writeProjectMarker(dest, {
      template: plan.template,
      targets: plan.targets,
      abilities: defaultAbilities,
    });
    // Fill the README's run instructions for exactly the surfaces we kept.
    writeReadmeRunSteps(dest, plan.targets);
  } catch (err) {
    process.stderr.write(
      `lloyal: scaffold failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  process.stdout.write(
    `scaffolded ${plan.name} (${plan.template}) · targets: ${plan.targets.join(', ')} · model: ${plan.llm}\n`,
  );

  // Fetch + Ed25519-verify the template's default ability(s) and vendor them as
  // local `file:` deps (npm never fetches a remote URL — npm-12 clean, and the
  // default ability gets the SAME signature verification as any added ability). This
  // runs whether or not we go on to `npm install`, because the template's
  // harness.ts imports these packages: without the `file:` deps in package.json
  // the user's OWN `npm install` still leaves a project that fails typecheck and
  // cannot boot. Only --skip-abilities opts out. A network/verify failure warns +
  // continues (an offline scaffold is still a scaffold) and the spec is reported
  // as pending so the user can add it with `lloyal install`.
  const pendingAbilities: string[] = [];
  if (opts.vendorAbilities) {
    for (const rawSpec of defaultAbilities) {
      try {
        const v = await verifyAndVendorAbility(dest, parseAbilitySpec(rawSpec), { disclose: false });
        process.stdout.write(`  vendored ${v.name}@${v.version} → ${v.vendorRelPath}\n`);
      } catch (err) {
        process.stderr.write(
          `lloyal: could not fetch default ability ${rawSpec}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        pendingAbilities.push(rawSpec);
      }
    }
  } else {
    pendingAbilities.push(...defaultAbilities);
  }

  const installed = opts.install ? await runInstall(dest) : false;
  printNextSteps({ name: plan.name, targets: plan.targets, installed, pendingAbilities });
  return 0;
}

