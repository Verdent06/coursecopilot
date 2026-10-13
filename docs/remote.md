# Remote / HTTP mode (M9)

CourseCopilot is local-first. Claude Desktop, Claude Code, Cursor, and Gemini CLI
talk to it over **stdio**. Three clients can only reach a server from *their*
cloud, so they need a public Streamable HTTP URL:

| Client | Why remote? |
|---|---|
| [claude.ai](https://claude.ai) web / mobile / Cowork | Anthropic's cloud connects; the server must be on the public internet. |
| ChatGPT developer mode | OpenAI's cloud connects. Plan-gated. |
| Gemini app (Spark custom apps) | Google's cloud connects. Eligibility-gated. |

There is **no central hosted CourseCopilot**. You run `coursecopilot serve --http`
on your laptop (plus `coursecopilot tunnel`) or on a one-click deploy you own.
Canvas tokens stay on that instance (`CANVAS_TOKEN` / `canvas connect` on the host; never accept someone else’s token).

Transport: [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports) (2026-07-28, POST to one endpoint). An SSE alias is not served; Gemini Enterprise rejects SSE anyway.

## Auth research (Oct 2026) — why OAuth is in M9

Spec §13 defaulted OAuth to v1.1 unless a web client refused no-auth URLs.

| Client | No-auth URL? | Static bearer / request header? | OAuth |
|---|---|---|---|
| **claude.ai** | Yes. Add custom connector → Authentication **No sign in**. Anyone with the URL can use it. | Yes. **Request headers** (beta, some orgs): paste `Authorization: Bearer <token>`. [Custom connectors](https://claude.com/docs/connectors/custom/add-unlisted), [Authentication](https://claude.com/docs/connectors/building/authentication) (`none`, `static_headers`, `oauth_dcr`, `oauth_cimd`). | Optional. Sign in now / when needed. Claude prefers CIMD (its published identity) and also does DCR. Redirect: `https://claude.ai/api/mcp/auth_callback`. |
| **ChatGPT** | Yes. Add custom MCP server → **No authentication**. | Not as a first-class “paste a bearer header” field in the plugin dialog. OAuth or none (or mixed). | Optional. OAuth 2.1 + PKCE; CIMD or DCR. [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Auth](https://developers.openai.com/plugins/build/auth). |
| **Gemini Spark** | **No.** The Help page only describes pasting an MCP URL and, if the server lacks Dynamic Client Registration, entering credentials under Advanced features. Field reports: Spark probes RFC 9728 → RFC 8414 `registration_endpoint` → DCR → PKCE. | Only as the Advanced-features static client id/secret fallback when DCR is missing. | **Required** for the consumer Gemini app path. [Custom apps for Spark](https://support.google.com/gemini/answer/17209137?co=GENIE.Platform%3DDesktop&hl=en). |

**Decision:** M9 ships all three:

1. **Secret URL path** `/mcp/<128-bit hex>` — documented as weaker — for claude.ai / ChatGPT **No sign in / No authentication**.
2. **Bearer token** `Authorization: Bearer <token>` — Cursor, Claude Code `--transport http`, Gemini CLI `-t http`.
3. **Single-user OAuth 2.1** with PKCE S256, RFC 7591 DCR, RFC 9728 PRM, RFC 8414 ASM, refresh tokens, and CIMD (`client_id` that is an `https://` URL). Needed so Gemini Spark works at launch.

This is still single-user and self-hosted: the consent page is “Approve CourseCopilot on this machine.” There is no multi-tenant IdP.

Live connections from claude.ai, ChatGPT, and the Gemini app to a tunnel **and** a Render deploy are launch-blocking in **M12**, not this PR. This PR proves the protocol with `@modelcontextprotocol/client` over HTTP.

## Run locally

```bash
npm run build
node dist/cli.js serve --http --port 8787
```

Binds **127.0.0.1** by default (Host header checked; `*.trycloudflare.com` is allowed for tunnels). Prints the bearer token, secret-path URL, and click paths.

Env / flags:

| Flag / env | Role |
|---|---|
| `--port` / `PORT` | Default 8787. When `PORT` is set (Render/Fly), bind defaults to `0.0.0.0`. |
| `--bind` / `COURSECOPILOT_BIND` | `127.0.0.1` or `0.0.0.0`. |
| `--token` / `COURSECOPILOT_TOKEN` | Bearer token. Generated if omitted (128-bit hex). |
| `--secret-path` / `COURSECOPILOT_SECRET_PATH` | Path segment. Defaults to the same token. |
| `--allow-path` / `COURSECOPILOT_ALLOW_PATH=1` | Allow `file`/`folder` ingest. **Off** in HTTP mode so a remote caller cannot read disk. |
| `--public-url` / `COURSECOPILOT_PUBLIC_URL` | Issuer / resource origin for OAuth metadata. Otherwise taken from `X-Forwarded-Proto` + `Host`. |
| `--no-oauth` / `COURSECOPILOT_OAUTH=0` | Disable the authorization server. Gemini Spark will not connect. |
| `--oauth-auto-approve` | Tests only: skip the HTML consent page. |

Health: `GET /health` → `{ ok: true, name, version }`.

OAuth discovery (when enabled):

- `GET /.well-known/oauth-protected-resource` (and path-aware `/mcp`)
- `GET /.well-known/oauth-authorization-server`
- `POST /oauth/register` (aliases: `/register`, `/api/oauth/register`)
- `GET\|POST /oauth/authorize` (alias `/authorize`)
- `POST /oauth/token` (aliases `/token`, `/api/oauth/token`)

Registered OAuth clients persist in `$COURSECOPILOT_HOME/oauth.json` (mode 0600).

ChatGPT Deep Research aliases: tools `search` and `fetch` match [OpenAI's MCP search/fetch schema](https://developers.openai.com/api/docs/mcp) (`results[].id|title|url` and `id|title|text|url|metadata`). They wrap `search_course` / `get_chunk`.

## `coursecopilot tunnel`

Wraps a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) (`cloudflared tunnel --url http://localhost:8787`). `cloudflared` is [Apache-2.0](https://github.com/cloudflare/cloudflared); the CLI downloads it from GitHub Releases into `~/.coursecopilot/bin/` if it is not on `PATH`.

```bash
node dist/cli.js tunnel --port 8787
```

Starts `serve --http` and prints `https://<random>.trycloudflare.com`. **The hostname changes every restart.** For a stable URL use a [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) or a one-click deploy.

Caveat: Quick Tunnels **do not support SSE**. CourseCopilot answers MCP POST with JSON unless a tool streams notifications. If a client insists on a GET SSE stream (Gemini Spark sometimes does), use Render/Fly.

## One-click deploys

Always-on, stable HTTPS, persistent volume for `/data` (`COURSECOPILOT_HOME` + Hugging Face cache). Set `COURSECOPILOT_TOKEN` (and optional `CANVAS_TOKEN` on **your** instance only).

### Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Verdent06/coursecopilot)

Blueprint: [`render.yaml`](../render.yaml) (repo root; Render requires that). Docker image from [`Dockerfile`](../Dockerfile), 2 GB disk on `/data`, health check `/health`.

After deploy, open `https://<service>.onrender.com/` — the landing page lists the MCP URLs. Put that origin in `COURSECOPILOT_PUBLIC_URL`.

### Fly.io

```bash
fly launch --config deploy/fly.toml
fly volumes create cc_data --size 2
fly secrets set COURSECOPILOT_TOKEN=$(openssl rand -hex 16)
fly secrets set COURSECOPILOT_SECRET_PATH=$COURSECOPILOT_TOKEN
fly secrets set COURSECOPILOT_PUBLIC_URL=https://<app>.fly.dev
fly deploy
```

1 GB RAM (ONNX MiniLM). Config: [`deploy/fly.toml`](fly.toml).

### Cloudflare Containers

Native addons need Containers, not Workers. Template: [`deploy/cloudflare/`](cloudflare/). If Containers cannot load `better-sqlite3` in your account, skip this and use Render/Fly.

## What each web client needs

### claude.ai (web / mobile / Cowork)

Official: [Use connectors](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities), [Custom connectors / remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted), [Authentication](https://claude.com/docs/connectors/building/authentication).

1. Server must be **public HTTPS** (tunnel or deploy). Anthropic's cloud connects, not your laptop.
2. Customize → Connectors → Add → Custom → **Web** → paste:
   - **No sign in:** `https://<host>/mcp/<secret>` (secret-path auth).
   - **OAuth:** `https://<host>/mcp`, Authentication **Sign in now**, OAuth client **Use Claude's published identity** (CIMD) or **Register automatically** (DCR). Approve the consent page.
   - **Request headers** (beta, some orgs): URL `https://<host>/mcp`, header `Authorization` = `Bearer <token>`.
3. Free plan: **1 custom connector**.
4. We could not click through a live claude.ai account in this milestone **[UNVERIFIED live]**.

### ChatGPT (developer mode)

Official: [Developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt), [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels.md) (ChatGPT-only; needs Platform org tunnel permissions), [search/fetch schema](https://developers.openai.com/api/docs/mcp).

1. Enable **developer mode**. Access is **plan-gated**; we did not confirm Free/Plus. README: “ChatGPT support needs a plan with developer mode. Check OpenAI's page.”
2. ChatGPT Plugins → **+** → **Add custom MCP server** → name + **Server URL**.
   - **No authentication:** `https://<host>/mcp/<secret>`.
   - **OAuth:** `https://<host>/mcp` (DCR or CIMD). Mixed auth: `initialize` / `tools/list` without a token, tools per `securitySchemes` — we still require a token or secret path on `/mcp` unless the secret path is used.
3. Protocols: **SSE and streaming HTTP**. We serve Streamable HTTP.
4. **Pro: read/fetch tools only** (Help Center). Retrieval tools set `readOnlyHint: true`. `record_quiz_attempt` is a write and may be unavailable on Pro (M8).
5. `search` / `fetch` aliases are registered for Deep Research / company-knowledge compatibility.
6. Live ChatGPT connection is **[UNVERIFIED live]** (M12).

### Gemini app (gemini.google.com + mobile) via Spark custom apps

Official: [Connect & manage custom apps for Gemini Spark](https://support.google.com/gemini/answer/17209137?co=GENIE.Platform%3DDesktop&hl=en), [Connected Apps](https://support.google.com/gemini/answer/13695044?hl=en-gb).

1. **Must use OAuth with Dynamic Client Registration** (or paste a static client id/secret under Advanced features). Secret-path no-auth is not documented and is treated as insufficient.
2. Paste **`https://<host>/mcp`** (not the secret path). Spark discovers `/.well-known/oauth-protected-resource`, then `/.well-known/oauth-authorization-server` (`registration_endpoint`), POSTs DCR, then PKCE.
3. Add the app **on the web**; it then works in Spark on web and mobile.
4. **Gates:** Gemini Spark access, **personal** Google account (not work/school — a `umich.edu` login will not work), US, 18+, English, Keep Activity on. Students on school Google should use **Gemini CLI** (stdio, configured by M10 `setup`).
5. Write tools ask for manual confirmation.
6. Google AI Studio has **no MCP client** ([feature request](https://discuss.ai.google.dev/t/feature-request-native-mcp-client-support-via-sse-http-tunnels-in-google-ai-studio/180380)). Gemini Enterprise is admin-only Streamable HTTP ([docs](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server)).
7. Live Spark connection is **[UNVERIFIED live]** (M12). If Spark still demands a static client id, create one via `POST /oauth/register` and paste it under Advanced features.

### Local clients (not this milestone)

Stdio remains the default (`coursecopilot` with no args). Remote HTTP with a bearer token also works for Claude Code (`claude mcp add --transport http`) and Gemini CLI (`gemini mcp add -t http`). `npx coursecopilot setup --remote` starts this HTTP server plus a tunnel and prints the paste URLs.

## Guards

- **Local paths:** HTTP mode sets `allowLocalPaths: false` unless `--allow-path`. `add_source(kind: file|folder)` and local `kind: transcript` paths fail with a pointer to website / pack / Canvas (or an `http(s)` transcript URL). YouTube URLs still work.
- **SSRF:** `assertPublicUrl` rejects loopback, RFC1918, link-local, ULA, CGNAT, and metadata hostnames on any `http(s)` URI passed to `add_source`. DNS-to-private is enforced when the website crawler (M4) fetches.
- **Host header:** localhost binds allow `localhost` / `127.0.0.1` / `[::1]` and `*.trycloudflare.com`. `0.0.0.0` (PaaS) allows any Host.
- Logs redact `Authorization` headers (`src/util/log.ts`).

## OpenAI Secure MCP Tunnel

ChatGPT-only alternative to Cloudflare: [Secure MCP Tunnels](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels.md). Needs a Platform org with Tunnels Read+Manage / Read+Use. Not wrapped by `coursecopilot tunnel`; point ChatGPT at our local `serve --http` through OpenAI's `tunnel-client` if you have those permissions.
