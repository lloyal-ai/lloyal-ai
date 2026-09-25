/**
 * A gzipped ustar tarball built by hand — node:zlib plus a manual header writer, matching the worker's
 * tarball-inspect test — so a test can hand the CLI the bytes a signed bundle would carry.
 */
import { gzipSync } from 'node:zlib';

const TAR_BLOCK = 512;

function writeField(buf: Uint8Array, off: number, val: string, len: number): void {
  const bytes = new TextEncoder().encode(val);
  for (let i = 0; i < len; i++) buf[off + i] = i < bytes.length ? bytes[i] : 0;
}

function header(name: string, size: number): Uint8Array {
  const h = new Uint8Array(TAR_BLOCK);
  writeField(h, 0, name, 100);
  writeField(h, 100, '0000644', 8);
  writeField(h, 124, size.toString(8).padStart(11, '0'), 12);
  writeField(h, 136, '00000000000', 12);
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  h[156] = 0x30;
  writeField(h, 257, 'ustar', 6);
  writeField(h, 263, '00', 2);
  let cksum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) cksum += h[i];
  writeField(h, 148, cksum.toString(8).padStart(6, '0'), 6);
  h[154] = 0x00;
  h[155] = 0x20;
  return h;
}

export function buildTarball(entries: Array<{ name: string; content: string }>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const body = new TextEncoder().encode(e.content);
    parts.push(header(e.name, body.byteLength));
    const padded = new Uint8Array(Math.ceil(body.byteLength / TAR_BLOCK) * TAR_BLOCK);
    padded.set(body);
    parts.push(padded);
  }
  parts.push(new Uint8Array(TAR_BLOCK * 2));
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const tar = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    tar.set(p, off);
    off += p.byteLength;
  }
  return new Uint8Array(gzipSync(tar));
}
