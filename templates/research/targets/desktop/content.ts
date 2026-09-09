/**
 * The content plane on this target: a custom scheme, not a port.
 *
 * A loopback server would be reachable by every process on the machine, and
 * these routes authenticate nothing by design — a digest is identity, not
 * authorization. `attachment://` is reachable only from this app's own
 * renderers and opens no socket at all.
 *
 * The routes are rig's `resolveContent`, the same table the web target serves
 * over HTTP, so a route added there arrives here for free and the two targets
 * cannot answer one URL differently.
 */
import { protocol } from "electron";
import { createProjectMediaStore, resolveContent } from "@lloyal-labs/rig/node";
import { MAX_DOCUMENT_BYTES, DOCUMENT_UPLOAD_TIMEOUT_MS } from "@lloyal-labs/media/node";
import type { Descriptor } from "@lloyal-labs/media";
import { readBounded, TooLarge, TooSlow } from "./read-bounded.js";

/**
 * Must run BEFORE app ready — afterwards the registration is ignored SILENTLY.
 *
 * All four privileges are load-bearing, and were found by measurement rather
 * than by reading: `standard` gives the scheme an origin so CSP can name it,
 * `secure` keeps it out of the mixed-content rules, `supportFetchAPI` lets
 * `fetch` address it, and without `corsEnabled` the scheme takes no part in
 * CORS at all — so the handler's `Access-Control-Allow-Origin` is never
 * consulted and every fetch fails before reaching it. `<img>` worked
 * throughout, which is what made that look like a CSP problem.
 */
export function registerContentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "attachment",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

/**
 * Serve reads from the project store; hand an upload to `ingest`.
 *
 * Reading needs no lock: OCI blobs are content-addressed and immutable, so a
 * reader racing the writer either finds the blob or does not. Writing is the
 * exception and is not ours — `ingest` belongs to whichever process owns the
 * store, and takes a signal so a deadline here can actually stop it.
 */
export function serveContentScheme(
  projectRoot: string,
  ingest: (bytes: Uint8Array, signal: AbortSignal) => Promise<Descriptor>,
): void {
  const media = createProjectMediaStore(projectRoot);
  // The renderer is cross-origin to this scheme — a Vite dev server in
  // development, `file://` in a build — so it has no origin to echo. `*` grants
  // nothing further: only this app's own renderers can address the scheme.
  const cors = { "Access-Control-Allow-Origin": "*" };

  protocol.handle("attachment", async (request) => {
    const path = new URL(request.url).pathname;

    // The plane's one WRITE, and the only route not answerable from the store.
    // The renderer reaches it with the same `fetch` the web target uses, so
    // `content-urls.ts` derives it from the origin exactly like the reads.
    if (request.method === "POST" && path === "/v1/media/ingress") {
      // ONE deadline over BOTH halves — the transfer and the ingest. Aborting
      // is what makes it real: a rejected promise here would leave the engine
      // still decoding, so the signal travels with the bytes. The same bounds
      // the web host passes its route, so both targets admit the same thing.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), DOCUMENT_UPLOAD_TIMEOUT_MS);
      try {
        const declared = Number(request.headers.get("content-length") ?? NaN);
        if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
          throw new TooLarge(`upload exceeds ${MAX_DOCUMENT_BYTES} bytes`);
        }
        const bytes = await readBounded(request.body, MAX_DOCUMENT_BYTES, ctrl.signal);
        const root = await ingest(bytes, ctrl.signal);
        return Response.json(root, { status: 201, headers: cors });
      } catch (err) {
        // The same statuses the HTTP route answers with, so a client cannot
        // tell the targets apart: 413 too large, 408 too slow, else refused.
        const late = err instanceof TooSlow || ctrl.signal.aborted;
        const status = err instanceof TooLarge ? 413 : late ? 408 : 400;
        // The deadline's own number belongs to the message, not to the reader
        // that was merely told to stop.
        const error = late
          ? `upload exceeded ${DOCUMENT_UPLOAD_TIMEOUT_MS}ms end to end`
          : err instanceof Error ? err.message : "ingest failed";
        return Response.json({ error }, { status, headers: cors });
      } finally {
        clearTimeout(timer);
      }
    }

    // `store` is an authority only because a `standard` scheme requires one;
    // every route lives under the path, exactly as on HTTP.
    const reply = resolveContent({
      method: request.method,
      path,
      ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
    }, media);
    if (!reply) return new Response(null, { status: 404 });
    return new Response(reply.body ?? null, {
      status: reply.status,
      headers: { ...reply.headers, ...cors },
    });
  });
}
