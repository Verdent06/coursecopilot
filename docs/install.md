# Install

Primary path: **`npx coursecopilot setup`**. It detects every local MCP client it can find, backs up each config, and merges `mcpServers.coursecopilot` without touching other servers.

[![Install MCP Server in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=coursecopilot&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNvdXJzZWNvcGlsb3RAbGF0ZXN0Il19)

```bash
npx coursecopilot setup
npx coursecopilot add-pack harvard-cs50x
npx coursecopilot doctor
```

One-liners if you skip setup:

```bash
claude mcp add -s user coursecopilot -- npx -y coursecopilot@latest
gemini mcp add -s user coursecopilot npx -y coursecopilot@latest
```

Then ask your AI: “quiz me on what I missed.”

Flags:

| Flag | Meaning |
|---|---|
| `--dry-run` | Print the JSON diff; write nothing |
| `--undo` | Restore the most recent backups from this tool |
| `--client claude-desktop\|claude-code\|cursor\|gemini` | Limit to one (or comma-separate / repeat) |
| `--remote` | Start `serve --http` plus a Cloudflare quick tunnel and print paste URLs |
| `--yes` | Non-interactive; skip optional Canvas / leccap / pack / model prompts |
| `--canvas` / `--leccap` / `--pack <id>` / `--download-model` | Run those optional steps |

Optional prompts (TTY only, unless you pass the flags above): Connect Canvas? Log in to UMich Lecture Capture? Add a starter pack? Pre-download the MiniLM model (~23 MB)?

Tokens are **never** written into client configs. Canvas lives in `~/.coursecopilot/secrets.json` (0600) or `CANVAS_*` env.

## Local clients (stdio)

Configs use:

```json
{
  "mcpServers": {
    "coursecopilot": {
      "command": "npx",
      "args": ["-y", "coursecopilot@latest"]
    }
  }
}
```

Claude Code adds `"type": "stdio"`.

| Client | Detection | File | What setup does |
|---|---|---|---|
| Claude Desktop | App or config dir | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows `%APPDATA%\Claude\claude_desktop_config.json`; Linux `~/.config/Claude/claude_desktop_config.json` **[UNVERIFIED Linux path]** | Backup, merge JSON. MCPB: double-click `coursecopilot.mcpb` (GitHub Release) or Settings → Extensions → Advanced → Install Extension. `user_config`: optional `canvas_base_url` / `canvas_token` (sensitive). |
| Claude Code | `claude` on PATH or `~/.claude.json` | `~/.claude.json` top-level `mcpServers` (user scope). `CLAUDE_CONFIG_DIR` supported. | Prefer `claude mcp add -s user coursecopilot -- npx -y coursecopilot@latest`; merge the file if the CLI is missing. |
| Cursor | `~/.cursor/` | `~/.cursor/mcp.json` | Backup, merge. Also prints a `cursor://anysphere.cursor-deeplink/mcp/install?name=coursecopilot&config=…` deeplink. |
| Gemini CLI | `gemini` on PATH or `~/.gemini/` | `~/.gemini/settings.json` | Prefer `gemini mcp add -s user coursecopilot npx -y coursecopilot@latest`; else merge `mcpServers`. |

Restart Claude Desktop fully. Reload Cursor MCP. In Claude Code / Gemini CLI run `/mcp`.

## Web clients (remote HTTP)

These cannot be detected locally. Anthropic’s / OpenAI’s / Google’s cloud connects, so the server must be public HTTPS.

```bash
npx coursecopilot setup --remote
```

Starts `serve --http` (M9) plus `coursecopilot tunnel` (Cloudflare quick tunnel; hostname changes every restart). Always-on: [Deploy to Render](https://render.com/deploy?repo=https://github.com/Verdent06/coursecopilot) · `deploy/fly.toml`.

### claude.ai (web / mobile / Cowork)

URL: `https://<host>/mcp/<secret>`

Steps: **Customize → Connectors → Add → Custom → Web** → paste URL → Authentication: **No sign in**.

Docs: [Custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). Free plan: 1 custom connector. OAuth alternative: paste `https://<host>/mcp` and Sign in now.

### ChatGPT (developer mode)

URL: `https://<host>/mcp/<secret>`

Steps: enable **developer mode** → Plugins → **+** → **Add custom MCP server** → URL → No authentication.

Docs: [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), [developer mode](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).

**Plan requirements:** ChatGPT support needs a plan with developer mode. Check OpenAI’s page. We did not confirm Free/Plus. **Pro is read/fetch only**; recording a quiz may need Claude/Cursor or Business/Enterprise/Edu.

### Gemini app — Custom apps for Spark

URL: `https://<host>/mcp` (OAuth + Dynamic Client Registration; **not** the secret path)

Steps: [gemini.google.com](https://gemini.google.com) → **Settings & help → Connected Apps → Custom apps for Spark → Add a custom app** → paste URL.

Docs: [Custom apps for Spark](https://support.google.com/gemini/answer/17209137?co=GENIE.Platform%3DDesktop&hl=en).

**Eligibility (must say so):** Gemini Spark, **personal** Google account (not work/school — a `umich.edu` login will not work), **US**, **18+**, English, Keep Activity on. Add the app on the web first. School accounts should use **Gemini CLI**. Google AI Studio has no MCP client.

Details: [docs/remote.md](remote.md).

## Doctor

```bash
npx coursecopilot doctor
npx coursecopilot doctor --json
npx coursecopilot doctor --offline
```

Checks Node ≥ 20, `better-sqlite3`, `sqlite-vec`, `onnxruntime-node`, DB integrity, the MiniLM model (downloads unless `--offline`), each detected client’s config, Canvas `/users/self` if a token is set, the leccap session file, pack registry reachability, and (when `COURSECOPILOT_PUBLIC_URL` or `--url` is set) MCP `initialize` on the public URL.

Non-zero exit if any required check fails. Warnings (keyword-only embeddings, registry down) do not fail the process.

## Troubleshooting

- Setup refused to write: the existing file is not valid JSON. Fix it or paste the printed snippet by hand. `--undo` restores the last backup (`<file>.bak-<timestamp>`).
- Client doesn’t see the server: restart / `/mcp` / confirm you edited the path in the table above (Claude Code is `~/.claude.json`, not `~/.claude/mcp.json`).
- Native module errors: `npm rebuild better-sqlite3 sqlite-vec`. Search still works keyword-only without sqlite-vec / ONNX.
- Canvas 401/403: [docs/canvas.md](canvas.md).
- Tunnel hostname changed: quick tunnels do that; use a named tunnel or Render/Fly for a stable URL.
