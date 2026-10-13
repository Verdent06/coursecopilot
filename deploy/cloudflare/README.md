# Cloudflare Containers

CourseCopilot needs native Node addons (`better-sqlite3`, `sqlite-vec`,
`onnxruntime-node`), so it cannot run on Workers. [Cloudflare Containers](https://developers.cloudflare.com/containers/)
run a Dockerfile; that is the path if you want it on Cloudflare.

Quick tunnels (`coursecopilot tunnel`) are the laptop path and do **not** need
this template. They also do not support SSE — see [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Deploy

From the repo root, with Wrangler that supports Containers:

```bash
npx wrangler deploy --config deploy/cloudflare/wrangler.jsonc
```

Set secrets:

```bash
npx wrangler secret put COURSECOPILOT_TOKEN
npx wrangler secret put COURSECOPILOT_SECRET_PATH
# optional Canvas (your own instance only)
npx wrangler secret put CANVAS_TOKEN
```

Mount a persistent volume for `/data` (`COURSECOPILOT_HOME`) so the SQLite index
survives deploys. If Containers in your account cannot load native addons,
use Render or Fly instead — those templates are the supported always-on path.
