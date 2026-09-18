/**
 * `backends:install` — put the signed CUDA backend pack on this box, through the project's own
 * lloyal.node. Provisioning, in one idempotent command: a deploy script runs it with `--yes`, an
 * operator runs it and reads the probe's reasons first.
 */
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import type { Command } from '../command.js';
import { harnessProjectRoot } from '../scaffold/project.js';
import { describeOffer, packPlatform, progressLine, projectPackHost, provisionCuda } from '../scaffold/backend-pack.js';

const USAGE = [
  'lloyal backends:install — install the signed CUDA backend pack for this box',
  '',
  'Usage:',
  '  lloyal backends:install [--yes]',
  '',
  'Probes the GPU, driver and CUDA runtime through the project\'s own lloyal.node, says what it found,',
  'and downloads the pack (plus the CUDA runtime when the box needs it) into ~/.cache/lloyal/backends/,',
  'once per lloyal.node version, shared by every harness on the box. Nothing is fetched without a yes;',
  '--yes answers it (deploy scripts). Only linux-x64 has a published pack.',
  '',
  'After it, harness.yml says `model.llm.gpu: cuda` and the harness starts on the GPU.',
].join('\n');

const asMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const backendsInstallCommand: Command = {
  name: 'backends:install',
  summary: 'Install the signed CUDA backend pack for this box (once per lloyal.node version)',
  usage: USAGE,
  async run(argv) {
    const { values } = parseArgs({
      args: [...argv],
      options: { help: { type: 'boolean', short: 'h' }, yes: { type: 'boolean', short: 'y' } },
      allowPositionals: false,
    });
    if (values.help) { process.stdout.write(`${USAGE}\n`); return 0; }
    try {
      const root = harnessProjectRoot();
      if (!packPlatform()) {
        process.stdout.write(`no backend pack is published for ${process.platform}-${process.arch}; the npm packages cover it.\n`);
        return 0;
      }
      const host = await projectPackHost(root);
      if (!host) {
        throw new Error('this project has no @lloyal-labs/lloyal.node that knows the backend pack — run `npm install` first.');
      }
      const probe = await host.probe();
      process.stdout.write(`lloyal.node ${host.version}${probe.gpu ? ` · ${probe.gpu.name}` : ''}\n${describeOffer(probe).join('\n')}\n`);
      if (probe.recommended && !values.yes) {
        if (!process.stdin.isTTY) throw new Error('not a terminal and no --yes: nothing is fetched without a yes.');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question('install it? [y/N] ')).trim().toLowerCase();
        rl.close();
        if (answer !== 'y' && answer !== 'yes') { process.stdout.write('left as is.\n'); return 0; }
      }
      const outcome = await provisionCuda(root, { fetch: probe.recommended, onProgress: progressLine((s) => process.stderr.write(s)) });
      if (outcome.kind === 'pack') process.stderr.write('\n');
      process.stdout.write(
        outcome.kind === 'pack' ? `installed → ${outcome.dir}\n  harness.yml: model.llm.gpu: cuda — every harness on this box using lloyal.node ${host.version} loads it.\n`
        : outcome.kind === 'npm' ? 'nothing to install: the npm package serves this GPU natively.\n  harness.yml: model.llm.gpu: cuda\n'
        : `nothing installed — ${outcome.why}.\n`,
      );
      return 0;
    } catch (err) {
      process.stderr.write(`lloyal backends:install: ${asMessage(err)}\n`);
      return 1;
    }
  },
};
