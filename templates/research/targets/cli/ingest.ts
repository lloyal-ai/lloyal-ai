/**
 * The engine's half of the desktop ingress: bytes in, a root descriptor back.
 *
 * It runs here rather than in the window process because the engine is the
 * store's single WRITER — main reads blobs off disk with no lock, which is
 * sound only while one process writes them.
 */
import type { ContentIngress } from "@lloyal-labs/media";

/** The Electron `utilityProcess` channel, structurally — this target is a
 *  terminal binary first and must not depend on `electron`. It is the same
 *  channel `@lloyal-labs/binding`'s `ipc()` uses, which ignores every frame
 *  that is not a `command`, so these ride alongside without disturbing it. */
interface ParentPort {
  postMessage(m: unknown): void;
  on(e: "message", cb: (ev: { data: unknown }) => void): void;
  off?(e: "message", cb: (ev: { data: unknown }) => void): void;
  removeListener?(e: "message", cb: (ev: { data: unknown }) => void): void;
  start?(): void;
}

type Request = { t: "ingest"; id: number; bytes: Uint8Array };

/** Answer the shell's ingest requests until the returned disposer is called.
 *  A no-op without a parent: a terminal has no renderer to serve. */
export function serveIngest(ingress: ContentIngress): () => void {
  const pp = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (!pp) return () => {};

  const onMessage = (ev: { data: unknown }): void => {
    const m = ev.data as Partial<Request>;
    if (m?.t !== "ingest" || typeof m.id !== "number" || !m.bytes) return;
    const { id, bytes } = m as Request;
    void ingress
      .ingest(bytes)
      .then((root) => pp.postMessage({ t: "ingested", id, root }))
      .catch((err: unknown) =>
        pp.postMessage({
          t: "ingestFailed",
          id,
          error: err instanceof Error ? err.message : "ingress failed",
        }),
      );
  };

  pp.on("message", onMessage);
  pp.start?.();
  return () => { (pp.off ?? pp.removeListener)?.call(pp, "message", onMessage); };
}
