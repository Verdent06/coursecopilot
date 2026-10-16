# Canvas (read-only)

CourseCopilot talks to **your** Canvas instance. It never writes back (no submissions, discussions, messages, or grades).

**Many schools — including UMich — block students from creating personal access tokens** (“Your Canvas administrators have chosen to limit your ability to generate your own access token”). CourseCopilot is built for that. A token is optional.

Any Canvas host works (`https://umich.instructure.com`, a school vanity domain, …).

## Connect (three tiers)

### 1. Calendar feed — zero setup, due dates

In Canvas: **Calendar → Calendar Feed** (bottom of the calendar). Copy the ICS URL.

- **In chat:** `connect_canvas` → open the hosted page → paste the URL there (never in chat; the feed URL is a secret).
- **Advanced / local:** `npx coursecopilot canvas connect --ics-url 'https://….ics' --yes`

`canvas_list_assignments` and the `whats_due` prompt then work across every course. No token, no extension.

### 2. Browser extension — full read, still no token

Install [CourseCopilot Sync](../extension/README.md) (Chrome / Edge / Firefox, Manifest V3). Stay signed into Canvas via SSO / Okta / Duo.

1. `connect_canvas` shows a one-time pairing code and the host URL.
2. Open the extension → paste host + code → **Pair**.
3. Open a signed-in Canvas tab → **Sync Canvas**.

The extension calls the Canvas REST API from your browser (`credentials` + `_csrf_token` as `X-CSRF-Token`) and POSTs a JSON snapshot (courses, modules, pages, files metadata, assignments, announcements) to **your** library. Read-only; you click Sync. Cookies are never uploaded.

Live tools then use that snapshot. Hosted page: `/extension`.

### 3. Personal access token — only if the school allows it

If Account → Settings → Approved Integrations still shows **+ New Access Token**:

```bash
npx coursecopilot canvas connect --base-url https://umich.instructure.com --token "$CANVAS_TOKEN" --yes
```

Or paste URL + token on the hosted connect page. Env `CANVAS_BASE_URL` / `CANVAS_TOKEN` still work on a single-user machine (ignored inside a hosted user scope).

The token is never written to the SQLite database, course packs, client MCP JSON, or logs.

## What it reads

Live tools (short-cached; PAT, extension snapshot, or ICS):

| Tool | PAT / extension | ICS feed only |
|---|---|---|
| `canvas_list_assignments` | yes | **yes** (due dates) |
| `canvas_list_courses` | yes | no |
| `canvas_list_modules` / `_files` / `_pages` / `canvas_get_page` | yes | no |
| `canvas_list_announcements` | yes | no |

Prompt: `whats_due` (default 7 days).

Indexed content (`add_source` `kind: "canvas"` `uri: "canvas://course/<id>"`) still uses a PAT when present.

## What if my school blocks tokens?

That is expected. Use tier 1 (ICS) and/or tier 2 (extension). `tokens_blocked` / `token_rejected` on the PAT path tell you the same thing — they do not crash.

You can still add a public course website, a pack, or upload files.

## Remote / hosted

Do not set a shared `CANVAS_TOKEN` on a multi-user host. Each OAuth user connects their own feed, extension, or token.
