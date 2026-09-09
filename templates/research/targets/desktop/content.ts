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

/** Over the cap. Separate from a refusal so the client is told which limit. */
class TooLarge extends Error {}
/** Past the deadline — the transfer, the ingest, or both together. */
class TooSlow extends Error {}

/**
 * Read the body, refusing AT the cap rather than after it.
 *
 * `Content-Length` is checked first because it costs nothing, but the stream is
 * the authority — the declared length is a claim. Chunks are dropped the moment
 * the total passes the ceiling, so an oversize upload is never accumulated and
 * never forwarded, and the reader is cancelled so the producer stops too.
 */
async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  cap: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new TooSlow(`upload exceeded ${DOCUMENT_UPLOAD_TIMEOUT_MS}ms`);
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen > cap) throw new TooLarge(`upload exceeds ${cap} bytes`);
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  const out = new Uint8Array(seen);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
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
        const status = err instanceof TooLarge ? 413
          : err instanceof TooSlow || ctrl.signal.aborted ? 408
          : 400;
        return Response.json(
          { error: err instanceof Error ? err.message : "ingest failed" },
          { status, headers: cors },
        );
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
