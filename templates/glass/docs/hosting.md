# Hosted web

Glass uses the public rig host: one resident model shared by independently admitted session contexts. The browser connects over WebSocket. Models, tools and content remain on the host.

From the project root, with Node 24+ and [Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy) installed:

```sh
npm ci
npm run build:web
HOST=127.0.0.1 PORT=8788 MAX_SESSIONS=2 npm run serve
```

In another terminal, from the same directory:

```sh
GLASS_HOST_PORT=8788 WEB_PORT=8102 caddy run --config deploy/Caddyfile
```

Open `http://127.0.0.1:8102`. The gateway serves built browser assets and forwards `/socket`, `/v1/media/*` and `/v1/content/*` to the same host. Conversation routes fall back to the application entry. No Vite development server is required. The example binds loopback; an SSH tunnel can expose it on your own machine:

```sh
ssh -N -L 8102:127.0.0.1:8102 your-host
```

For shared hosting, put the gateway behind your authenticated HTTPS ingress, or deliberately configure your own public access policy. The application currently shares one conversation library across sessions; it does not implement user accounts or tenant isolation. Microphone capture requires a secure browser context (HTTPS or localhost).

`MAX_SESSIONS` counts resident browser sessions, including idle tabs. Each owns its context and bound services; additional clients queue. Size the limit against the deployed models, context, service configuration and GPU memory. Closing a socket releases its session. Two-session correctness/admission checks are not a capacity benchmark.

Keep `models/`, `media/`, `conversations/` and local configuration on persistent storage. Run one host process per conversation directory. Stop through normal process signals and allow owned work to settle. Preserve the directory when replacing application code.

`targets/web/.env` holds defaults. Environment variables override `.env.local`, which overrides `.env`. Keep credentials out of committed files. A model or harness code change needs a process restart; normal ability settings use the public runtime configuration path.
