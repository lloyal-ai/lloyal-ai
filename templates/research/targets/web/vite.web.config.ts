import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * The web target's browser app (`npm run dev:web` / `npm run build:web`). Rooted
 * at `targets/web`; it connects to the local `npm run serve` host over wss (see
 * `web-bridge.ts`). Point it elsewhere with `VITE_WSS_URL` or `?server=`; the
 * content plane follows the same host automatically (`VITE_CONTENT_URL` /
 * `?content=` override it independently).
 */
export default defineConfig(({ mode }) => {
  // The host's own settings, read from the SAME files `bin/serve.js` reads and in the same order of
  // authority: a real environment variable, then `.env.local`, then the committed `.env`. Moving the
  // host has to move its clients with it — the socket the page opens and the proxy its uploads take
  // — or following the one documented place to configure it disconnects the app.
  const file = loadEnv(mode, __dirname, "");
  const host = process.env.HOST ?? file.HOST ?? "127.0.0.1";
  const port = process.env.PORT ?? file.PORT ?? "8787";
  const origin = `http://${host}:${port}`;

  return {
  root: resolve(__dirname),
  plugins: [react()],
  // The page's default socket, resolved here so it cannot drift from the proxy below or from the
  // host itself. `VITE_WSS_URL` and `?server=` still point it somewhere else entirely.
  define: { __DEFAULT_WSS__: JSON.stringify(`ws://${host}:${port}`) },
  server: {
    port: 5173,
    // Both planes of the served host reach the browser through THIS origin in
    // dev: the page is on :5173, the host wherever it was configured. Proxying
    // the content plane keeps its requests same-origin, so no CORS preflight is
    // involved and the host needs no `allowedOrigin` for local work.
    // `/v1/media` carries uploads and representations; `/v1/content` answers
    // existence by digest.
    proxy: {
      "/v1/media": { target: origin, changeOrigin: true },
      "/v1/content": { target: origin, changeOrigin: true },
    },
  },
  build: { outDir: resolve(__dirname, "../../dist-web"), emptyOutDir: true },
  };
});
