#!/usr/bin/env node
// The web target's entry: load the box's settings, then the built host.
//
// The host is a plain Node process, so nothing reads a `.env` for it the way
// Vite does for the browser bundle. Both halves read the SAME directory, so a
// port or a host name is written once and both ends of the socket agree.
//
// ORDER MATTERS, and not the way the convention suggests: `loadEnvFile` never
// overwrites a name that is already set, so the FIRST file to define one wins.
// `.env.local` is therefore loaded first — load it second and a machine's own
// numbers would be silently ignored while appearing to be read. A real
// environment variable is set before either, so it still beats both:
// `MAX_SESSIONS=2 npm run serve`.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "targets", "web");
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(join(web, file));
  } catch {
    // Absent is the normal case for `.env.local` on a fresh clone.
  }
}

import("../dist/targets/web/serve.mjs");
