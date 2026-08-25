/**
 * `bin/serve.js`'s entry — the web target's served-host runner. Stands up a `ws`
 * server that serves N browser Sessions over ONE resident model (the model-runtime
 * host + the wss front door in one process). It's the SAME
 * `harness(ctx, events, commands)` the cli and desktop run — only the binding differs;
 * the browser connects with `connectWss` (see `web-bridge.ts`).
 *
 * `npm run serve` builds + starts this; then `npm run dev:web` serves the browser
 * app that talks to it. Loopback + no-auth for local dev — token auth is a
 * front-door concern, deferred.
 *
 * ESBUILT (it injects `runServedSession` → the harness → its `.eta` prompts, so it
 * must bundle with `--loader:.eta=text`, never tsx).
 *
 * ONE adaptation over reasoning.run's env-sourced `serve/main.ts`: the **config
 * source**. Instead of `LLOYAL_MODEL`/`LLOYAL_RERANKER` env vars, `resolveConfig`
 * reads `harness.yml` and resolves the llm + reranker specs to concrete
 * digest-verified `.gguf` paths via rig's `resolveModel` (batteries included, no env
 * needed). Everything else — `createServedHostDriver`, `createModelRuntimeHost`, the
 * `ws` WebSocketServer, the wss per-connection binding, admit/release — is
 * reasoning.run's serving code verbatim.
 *
 * SNAPSHOT: reasoning.run @ 0.8.0 (src/serve/main.ts).
 */
import { main, suspend, call } from "effection";
import type { Operation, Signal } from "effection";
import { WebSocketServer } from "ws";
import type { WsServerSocket } from "@lloyal-labs/binding/node";
import type { EventBus } from "@lloyal-labs/binding";
import { resolveModel } from "@lloyal-labs/rig/node";
import { createServedHostDriver } from "./driver.js";
import { runServedSession } from "../../harness/served-session.js";
import type { WorkflowEvent, Command } from "../../harness/protocol.js";
import { loadConfig, loadYml } from "../../harness/config.js";
import type { HarnessYml } from "../../harness/config.js";
import type { Config, LoadedConfig } from "../../harness/config-types.js";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
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

/**
 * Resolve the layered config's model specs to concrete digest-verified `.gguf`
 * paths (fetched on first run, no key). A saved `model.path`/`model.reranker`
 * in harness.json outranks the yml catalog id. The served factories read
 * `model.path` (+ `model.nCtx`) for the resident context and `model.reranker`
 * for the per-session cross-encoder.
 */
function* resolveConfig(): Operation<Config> {
  const modelPath = yield* call(() =>
    resolveModel({
      projectRoot: process.cwd(),
      role: "llm",
      spec: loaded.config.model.path
        ? { path: loaded.config.model.path }
        : { id: yml.model?.llm?.id },
      onProgress: (got, total) => {
        const pct = total > 0 ? Math.round((100 * got) / total) : 0;
        process.stderr.write(`\rfetching ${yml.model?.llm?.id ?? "model"} — ${pct}%   `);
      },
    }),
  );

  const rerankerPath = yield* call(() =>
    resolveModel({
      projectRoot: process.cwd(),
      role: "reranker",
      spec: loaded.config.model.reranker
        ? { path: loaded.config.model.reranker }
        : { id: yml.model?.reranker?.id, path: yml.model?.reranker?.path },
      onProgress: (got, total) => {
        const pct = total > 0 ? Math.round((100 * got) / total) : 0;
        process.stderr.write(`\rfetching reranker — ${pct}%   `);
      },
    }),
  );

  return {
    ...loaded.config,
    model: {
      ...loaded.config.model,
      path: modelPath,
      reranker: rerankerPath,
      nCtx: loaded.config.model.nCtx ?? 32768,
    },
  };
}

main(function* () {
  const cfg = yield* resolveConfig();
  const port = envInt("PORT", 8787);
  const maxNativeSessions = envInt("MAX_SESSIONS", 8);
  // Default to loopback: the pilot is no-auth, and ws's default all-interfaces bind for
  // `{ port }` would expose an unauthenticated model service on the LAN. `HOST=0.0.0.0`
  // is an explicit opt-in once an operator fronts it with auth/TLS.
  const bindHost = process.env.HOST ?? "127.0.0.1";

  const driver = yield* createServedHostDriver(cfg, {
    maxNativeSessions,
    // The host is payload-opaque — it erases the bus/command types to `unknown`. The
    // driver created these channels as WorkflowEvent/Command, so re-narrow them here.
    run: (m) =>
      runServedSession(
        cfg,
        loaded.origin,
        m.context,
        m.uiChannel as unknown as EventBus<WorkflowEvent>,
        m.commands as unknown as Signal<Command, void>,
      ),
  });

  const server = new WebSocketServer({ port, host: bindHost });
  // Server-level errors are almost always a bind failure (EADDRINUSE / EACCES). Without a
  // listener Node rethrows the EventEmitter 'error' as an uncaught exception with a bare
  // stack — surface an actionable message + exit non-zero for the operator/orchestrator.
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[serve] failed to bind ${bindHost}:${port} — ${err.code ?? err.message}`);
    process.exit(1);
  });
  server.on("connection", (socket) => {
    // The driver installs the socket's no-op 'error' handler itself (an unhandled
    // 'error' on a Node EventEmitter throws), so the boot just hands the socket off.
    driver.serveConnection(socket as unknown as WsServerSocket);
  });
  // Plaintext ws:// — TLS terminates upstream (reverse proxy / the managed front door),
  // never in this process, so label it "ws" (not "wss") for operators.
  console.log(
    `\n__NAME__ serving on ws://${bindHost}:${port} — up to ${maxNativeSessions} browser session(s) over ${cfg.model.path}`,
  );

  yield* suspend(); // run until the process is signalled (main handles SIGINT/SIGTERM)
});
