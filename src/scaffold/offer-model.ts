/**
 * The one write to `harness.yml` an install may make — asked, never unasked. A requirement the project does
 * not meet is put to the reader with the catalog's suggestion; a yes writes `model.<service>.id` through the
 * one model writer, anything else leaves the file as it is.
 */
import { createInterface } from 'node:readline/promises';
import { writeModelField } from './apply-model.js';
import type { MissingService } from './vendor-ability.js';

export async function offerToWrite(projectDir: string, missing: MissingService): Promise<boolean> {
  if (!missing.suggestion) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(
      `${missing.ability} needs a ${missing.service} and this project names none. Write \`${missing.key}: ${missing.suggestion}\` to harness.yml? [y/N] `,
    )).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') return false;
  } finally {
    rl.close();
  }
  writeModelField(projectDir, missing.service, { id: missing.suggestion });
  process.stderr.write(`lloyal: wrote ${missing.key}: ${missing.suggestion}\n`);
  return true;
}
