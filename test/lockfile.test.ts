/**
 * The committed lockfile must describe the committed manifest. The cutter
 * bumps `version`; a lockfile still recording the previous one makes a frozen
 * install (`npm ci`, which the front-door job runs) refuse. Cuts 2 through 6
 * shipped exactly that way, and nothing said so because the job never ran on
 * the arc.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

describe('the lockfile follows the manifest', () => {
  it('records this package at the version package.json declares', () => {
    const pkg = read('package.json') as { version: string };
    const lock = read('package-lock.json') as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
  });
});
