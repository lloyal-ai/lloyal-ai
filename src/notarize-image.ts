/**
 * Notarize and staple one disk image — as a process of its own, which is the point.
 *
 * `@electron/notarize` spawns `notarytool` and `stapler` and hands back neither a handle nor a
 * cancellation, so called in-process there would be nothing for `ship` to stop when a reader
 * presses Ctrl-C during an Apple wait that runs for minutes. Run here, it is an ordinary child in
 * its own process group and the runner that owns every other step owns this one too.
 *
 * It is also the only way to be sure of the library's debug output. `getNotarizationLogs` catches a
 * failed log fetch and logs the RAW error, which carries `spawnargs` — and on the Apple-ID route
 * that argv holds the app-specific password. `debug` decides what to print from `DEBUG` in the
 * environment at import time, a global that cannot be contained in-process. Here the parent builds
 * the environment instead of inheriting it, so the namespace cannot be switched on at all.
 *
 * Options arrive as one JSON object on stdin, never as arguments: an argument is readable by
 * anything running as this user for as long as the submission takes.
 */
import { notarize, type NotarizeOptions } from '@electron/notarize';

async function payload(): Promise<NotarizeOptions> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as NotarizeOptions;
}

try {
  await notarize(await payload());
} catch (err) {
  // The MESSAGE only, and deliberately: the library builds its own failures by interpolating what
  // the child said, which is safe, while everything unsafe lives on the error's PROPERTIES. The
  // object is never inspected, serialised or logged — not here, and not by whoever reads this.
  // Set the code and let Node leave on its own — never exit eagerly. stderr is a PIPE to the
  // parent, so the write is asynchronous and leaving early truncates it at one buffer —
  // measured: 200,007 characters written, 65,536 delivered. Apple's rejection log is exactly the
  // long message that would be lost, and it is the reason this adapter exists at all.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
