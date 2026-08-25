/**
 * The web target's boot — the `serve/main.ts` of the canonical serving
 * architecture. It resolves the resident model, hands the harness to the host via
 * the DRIVER (`createServedHostDriver`), and stands up the `ws` front door.
 *
 * The split is deliberate and matches reasoning.run (the production reference):
 * the host (`@lloyal-labs/host`) imports no harness; the harness
 * (`harness/harness.ts`) imports no host; the DRIVER (`./driver.ts`) is the only
 * file that knows both — this boot just wires config + the socket to it. It's the
 * SAME `harness(ctx, events, commands)` the cli and desktop run; only the binding
 * (wss, here) differs.
 *
 * `npm run serve` builds + starts this; then `npm run dev:web` serves the browser
 * app that talks to it. Config from `harness.yml` + env (PORT / HOST /
 * MAX_SESSIONS). Loopback + no-auth for local dev — TLS/auth terminate upstream.
 */
import { statSync } from "node:fs";
import { main, suspend, call } from "effection";
import type { Signal } from "effection";
import { WebSocketServer } from "ws";
import type { WsServerSocket } from "@lloyal-labs/binding/node";
import type { EventBus } from "@lloyal-labs/binding";
import { resolveModel } from "@lloyal-labs/rig/node";
import { createServedHostDriver } from "./driver.js";
import { abilities } from "../../harness/harness.js";
import { runServedSession } from "../../harness/served-session.js";
import type { WorkflowEvent, Command } from "../../harness/protocol.js";
import { loadConfig, loadYml } from "../../harness/config.js";
import type { HarnessYml } from "../../harness/config.js";
import type { Config, LoadedConfig } from "../../harness/config-types.js";

/** Best-effort file size for the boot header — never blocks the server boot. */
function fileSize(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

// The layered config: cli > env > harness.json > harness.yml > default. A bad
// manifest fails HERE — before any model fetch or bind.
const bootEnv = { ...process.env };
function loadOrExit(): { yml: HarnessYml; loaded: LoadedConfig } {
  try {
    const yml = loadYml();
    return { yml, loaded: loadConfig(yml, {}, bootEnv) };
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
const { yml, loaded } = loadOrExit();
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST ?? "127.0.0.1";
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) || 4;

main(function* () {
  // Resolve the resident model ONCE (fetched + digest-verified on first run, no
  // key). Every Session's context is created over this one path → shared weights.
  const modelPath = yield* call(() =>
    resolveModel({
      projectRoot: process.cwd(),
      role: "llm",
      // A saved/yml `model.path` outranks the yml catalog id.
      spec: loaded.config.model.path
        ? { path: loaded.config.model.path }
        : { id: yml.model?.llm?.id },
      onProgress: (got, total) => {
        const pct = total > 0 ? Math.round((100 * got) / total) : 0;
        process.stderr.write(`\rfetching ${yml.model?.llm?.id ?? "model"} — ${pct}%   `);
      },
    }),
  );

  // Resolve the reranker to a concrete path ONLY if an enabled ability declares the
  // service — the default wikipedia ability needs none, so we skip the ~630 MB fetch.
  // resolveModel honors a harness.yml pin (id or path) and digest-verifies on
  // first run, so `cfg.model.reranker` is then always a resolved PATH (never a
  // bare id) — the per-session provisioning below uses it as-is.
  let rerankerPath: string | undefined;
  const needsReranker = abilities.some((a) => (a.manifest?.services ?? []).includes("reranker"));
  if (needsReranker) {
    rerankerPath = yield* call(() =>
      resolveModel({
        projectRoot: process.cwd(),
        role: "reranker",
        // A saved reranker path outranks the yml entry.
        spec: loaded.config.model.reranker
          ? { path: loaded.config.model.reranker }
          : { id: yml.model?.reranker?.id, path: yml.model?.reranker?.path },
        onProgress: (got, total) => {
          const pct = total > 0 ? Math.round((100 * got) / total) : 0;
          process.stderr.write(`\rfetching reranker — ${pct}%   `);
        },
      }),
    );
  }

  // The live config the harness reads via RunnerCtx (built into a per-session
  // Runner inside runServedSession). Every Session's context is created over the
  // one resident model; the reranker (if any) is loaded per-session by
  // provisionAbilityModels from this resolved path.
  // The layered config with the model paths RESOLVED. `id` + `sizeBytes` feed
  // the measured boot header the harness emits on `ready`.
  const cfg: Config = {
    ...loaded.config,
    surface: "web",
    model: {
      ...loaded.config.model,
      path: modelPath,
      reranker: rerankerPath,
      nCtx: loaded.config.model.nCtx ?? 32768,
      // The display id mirrors the SAME selection resolution used: the
      // layered path when one won (a saved model must not display as the old
      // catalog id), else the yml catalog id.
      id: loaded.config.model.path ?? yml.model?.llm?.id ?? "model",
      sizeBytes: fileSize(modelPath),
    },
  };

  // Hand the harness to the host through the driver. The host is payload-opaque
  // (bus/command types erased to `unknown`); the harness created them as
  // WorkflowEvent/Command, so re-narrow them inside `run`.
  const driver = yield* createServedHostDriver(cfg, {
    maxNativeSessions: MAX_SESSIONS,
    run: (m) =>
      runServedSession(
        cfg,
        loaded.origin,
        m.context,
        m.uiChannel as unknown as EventBus<WorkflowEvent>,
        m.commands as unknown as Signal<Command, void>,
      ),
  });

  const server = new WebSocketServer({ port: PORT, host: HOST });
  server.on("error", (err: NodeJS.ErrnoException) => {
    process.stderr.write(`\nserve: failed to bind ${HOST}:${PORT} — ${err.code ?? err.message}\n`);
    process.exit(1);
  });
  server.on("connection", (socket) => {
    // The driver installs the socket's no-op 'error' handler itself (an unhandled
    // 'error' on a Node EventEmitter throws), so the boot just hands the socket off.
    driver.serveConnection(socket as unknown as WsServerSocket);
  });
  process.stderr.write(
    `\n__NAME__ serving on ws://${HOST}:${PORT} — up to ${MAX_SESSIONS} browser session(s) over one resident model.\n`,
  );
  yield* suspend();
});
