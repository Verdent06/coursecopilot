# Canvas (read-only)

CourseCopilot talks to **your** Canvas instance with **your** personal access token. It is not a multi-user Canvas app and it never writes back (no submissions, discussions, messages, or grades).

Any Canvas host works (`https://umich.instructure.com`, `https://canvas.instructure.com`, a school vanity domain, …).

## Connect

1. In Canvas: **Account → Settings → Approved Integrations → + New Access Token**.
2. Run:

```bash
npx coursecopilot canvas connect
```

It asks for the instance URL and token, calls `GET /api/v1/users/self`, and writes `~/.coursecopilot/secrets.json` with mode `0600`.

Non-interactive (scripts / CI):

```bash
npx coursecopilot canvas connect --base-url https://umich.instructure.com --token "$CANVAS_TOKEN" --yes
```

Or set env on the same machine that runs the server (required for remote/HTTP mode):

```bash
export CANVAS_BASE_URL=https://umich.instructure.com
export CANVAS_TOKEN=...
```

Env wins over the secrets file so a self-hosted `serve --http` instance can take tokens from its own environment.

**The token is never written to the SQLite database, course packs, client MCP JSON, or logs.** Authorization headers are redacted.

Claude Desktop `.mcpb` optional `user_config` fields (`canvas_base_url`, `canvas_token`, marked sensitive) map to those same env vars. Prefer `canvas connect` so the token is not sitting in a client config.

## What it reads

Live tools (short-cached, always hit Canvas):

| Tool | Purpose |
|---|---|
| `canvas_list_courses` | Active enrollments (`include_past` optional) |
| `canvas_list_modules` | Modules + items |
| `canvas_list_files` | Files; **403 on `/files` falls back to module File items** (typical student permission) |
| `canvas_list_pages` / `canvas_get_page` | Wiki pages (body as Markdown) |
| `canvas_list_assignments` | Due dates (ISO + the user’s Canvas timezone). All active courses if you omit an id. Default: upcoming, 14 days |
| `canvas_list_announcements` | Recent announcements as Markdown |

Prompt: `whats_due` (default 7 days) — assignments + announcements, grouped by course, then a study session for the nearest exam.

Indexed content (`add_source` `kind: "canvas"` `uri: "canvas://course/<id>"`):

- Front page, wiki pages (HTML through the website chunker)
- Module items: Page, File, Assignment description
- Files downloaded via the short-lived `url` (redirects followed) and sent through the PDF/PPTX/MD/TXT pipeline
- Announcements
- Citations: `[Canvas · <module> · <item>]` plus the item `html_url` (needs the student’s Canvas login to open)

Assignment names matching Midterm / Exam / Final become **suggested** `set_exam` dates (never auto-set). Assignment-group weights are included in the suggestion evidence.

## What if my school blocks tokens?

Some schools hide **+ New Access Token**. `canvas connect` and the live tools then return `tokens_blocked` (or `token_rejected` for an expired token) with this fallback — they do not crash:

1. Add the public course website: `add_source` `kind=website`
2. Install a course pack when one exists
3. Download files in the browser and `add_source` `kind=folder`

`canvas_not_configured` means you have not run `canvas connect` or set the env vars on this machine.

## Remote mode

Canvas tools only work when `CANVAS_TOKEN` (and `CANVAS_BASE_URL`) are set **on the self-hosted instance**. Do not paste a Canvas token into a server someone else runs.
