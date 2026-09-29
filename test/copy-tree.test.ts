import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyTreeWithSubstitutions, buildSubstitutions } from '../src/scaffold/copy-tree.js';

/**
 * The scaffold copier is the front door: whatever it does to a template, every
 * `npx lloyal-ai new` does to the developer's project. Three things it must
 * never do — witnessed 2026-09-04 on a checkout whose template carried a
 * link-local `node_modules`: it copied all 231 packages, and pushed each binary
 * through a UTF-8 text round trip (10.6 MB of Mach-O became 16.2 MB of U+FFFD)
 * with its exec bit dropped.
 */
describe('copyTreeWithSubstitutions', () => {
  const fixture = () => {
    const src = mkdtempSync(join(tmpdir(), 'tpl-'));
    const dest = mkdtempSync(join(tmpdir(), 'out-'));
    writeFileSync(join(src, 'README.md'), '# __NAME__\n');
    mkdirSync(join(src, 'bin'));
    // Bytes no UTF-8 decoder accepts: a lone continuation byte, then a Mach-O magic.
    const binary = Buffer.from([0x80, 0xcf, 0xfa, 0xed, 0xfe, 0x00, 0xff, 0x5f, 0x5f, 0x4e]);
    writeFileSync(join(src, 'bin', 'tool'), binary);
    chmodSync(join(src, 'bin', 'tool'), 0o755);
    mkdirSync(join(src, 'node_modules', 'dep', 'bin'), { recursive: true });
    writeFileSync(join(src, 'node_modules', 'dep', 'bin', 'x'), 'not yours to copy');
    return { src, dest, binary };
  };

  it('substitutes tokens in text files', () => {
    const { src, dest } = fixture();
    copyTreeWithSubstitutions(src, dest, buildSubstitutions('demo'));
    expect(readFileSync(join(dest, 'README.md'), 'utf8')).toBe('# demo\n');
  });

  it('copies a binary byte-for-byte and keeps its exec bit', () => {
    const { src, dest, binary } = fixture();
    copyTreeWithSubstitutions(src, dest, buildSubstitutions('demo'));
    const out = readFileSync(join(dest, 'bin', 'tool'));
    expect(Buffer.compare(out, binary)).toBe(0);
    expect(statSync(join(dest, 'bin', 'tool')).mode & 0o111).not.toBe(0);
  });

  /** This repository is also somewhere templates are RUN, so testing `ship --notarize` inside
   *  `templates/<t>` leaves a real signing certificate in `.env.local`, and any run leaves the
   *  local overlay. The exclusion used to be consulted only inside the directory branch, so no
   *  FILE was ever filtered by it and both would have been copied into every new project. */
  it("never scaffolds one machine's credentials, at any depth", () => {
    const { src, dest } = fixture();
    mkdirSync(join(src, 'targets', 'desktop'), { recursive: true });
    writeFileSync(join(src, 'targets', 'desktop', '.env.local'), 'CSC_KEY_PASSWORD=SYNTHETIC\n');
    writeFileSync(join(src, 'targets', 'desktop', '.env'), '# committed, and holds no secret\n');
    writeFileSync(join(src, 'harness.json'), '{"note":"SYNTHETIC"}\n');
    writeFileSync(join(src, 'harness.yml'), 'name: demo\n');
    copyTreeWithSubstitutions(src, dest, buildSubstitutions('demo'));

    expect(existsSync(join(dest, 'targets', 'desktop', '.env.local'))).toBe(false);
    expect(existsSync(join(dest, 'harness.json'))).toBe(false);
    // And the committed pair still travels: excluding a credential must not take the file that
    // documents where the credential goes with it.
    expect(existsSync(join(dest, 'targets', 'desktop', '.env'))).toBe(true);
    expect(existsSync(join(dest, 'harness.yml'))).toBe(true);
  });

  it('never scaffolds a node_modules the template happens to carry', () => {
    const { src, dest } = fixture();
    copyTreeWithSubstitutions(src, dest, buildSubstitutions('demo'));
    expect(existsSync(join(dest, 'node_modules'))).toBe(false);
  });
});
