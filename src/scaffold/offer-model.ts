/**
 * The one write to `harness.yml` an install may make — asked, never unasked. A requirement the project does
 * not meet is put to the reader with its remedy: the catalog's id under `model.<service>.id`, or the empty block
 * for a service the platform pairs from the llm. A yes writes it through the one model writer; anything else
 * leaves the file as it is.
 */
import { createInterface } from 'node:readline/promises';
import { writeModelBlock, writeModelField } from './apply-model.js';
import type { MissingService } from './vendor-ability.js';

export async function offerToWrite(projectDir: string, missing: MissingService): Promise<boolean> {
  const line = missing.block ? `${missing.key}: {}` : missing.suggestion ? `${missing.key}: ${missing.suggestion}` : null;
  if (!line) return false;
  const why = missing.block ? ' — the one paired with your model' : '';
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(
      `${missing.ability} needs a ${missing.service} and this project names none. Write \`${line}\` to harness.yml${why}? [y/N] `,
    )).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') return false;
  } finally {
    rl.close();
  }
  if (missing.block) writeModelBlock(projectDir, missing.service);
  else writeModelField(projectDir, missing.service, { id: missing.suggestion! });
  process.stderr.write(`lloyal: wrote ${line}\n`);
  return true;
}
