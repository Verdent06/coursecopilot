# CourseCopilot

Your classes, inside the AI you already use. Open-source MCP connector that turns any course (website, Canvas, PDFs, lectures) into cited answers and quizzes in Claude, ChatGPT, and more.

No API key. The host AI does all generation; this server fetches, indexes, retrieves, and stores learning state.

**Status:** M0–M11 (including **M10 setup + doctor** for every client) plus UMich CAEN Lecture Capture (`leccap`). See [docs/SPEC.md](docs/SPEC.md).

## Requirements

- Node.js 20 or later

## Install

```bash
npx coursecopilot setup
npx coursecopilot add-pack harvard-cs50x
```

Then ask Claude / Cursor / Gemini CLI: **quiz me on what I missed.**

`setup` detects Claude Desktop, Claude Code, Cursor, and Gemini CLI, backs up each config, and merges `mcpServers.coursecopilot` without touching other servers. It prints exact paste URLs for **claude.ai**, **ChatGPT** (developer mode — plan-gated), and the **Gemini app** (Custom apps for Spark; personal US Google accounts, 18+ only).

```bash
npx coursecopilot setup --remote    # serve --http + Cloudflare tunnel; paste the URL
npx coursecopilot doctor            # Node, native modules, DB, clients, Canvas, leccap, registry
npx coursecopilot doctor --json
npx coursecopilot setup --undo      # restore the last config backups
```

Manual JSON / MCPB / Cursor deeplink / click paths: **[docs/install.md](docs/install.md)**.

### Run the MCP server yourself (stdio)

With no arguments, `coursecopilot` speaks MCP over stdio (stdout is the protocol; logs go to stderr).

```bash
npm install
npm run build
node dist/cli.js
# or: npm install -g . && coursecopilot
npx @modelcontextprotocol/inspector node dist/cli.js
```

Data lives in `~/.coursecopilot/cc.db` (override with `COURSECOPILOT_HOME`).

## Remote mode (claude.ai, ChatGPT, Gemini app)

Those clients connect from the vendor's cloud, so the server must be public HTTPS.

```bash
node dist/cli.js serve --http --port 8787
node dist/cli.js tunnel          # Cloudflare quick tunnel (hostname changes each run)
```

Auth: secret URL path `/mcp/<token>` (claude.ai / ChatGPT no-auth), `Authorization: Bearer` (Cursor / Claude Code / Gemini CLI), and **single-user OAuth 2.1 + DCR** (required for Gemini Spark).

One-click always-on: [Deploy to Render](https://render.com/deploy?repo=https://github.com/Verdent06/coursecopilot) · `deploy/fly.toml` · `deploy/cloudflare/`.

Exact click paths, official-doc citations, and plan/eligibility gates: **[docs/remote.md](docs/remote.md)**.

ChatGPT support needs a plan with developer mode — check [OpenAI's page](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt). Gemini app custom apps need Spark, a personal US Google account, 18+, English, Keep Activity on; school accounts should use Gemini CLI instead.

## Course packs

A pack is a small JSON/YAML manifest: course id/name/term, **http(s) source URLs** (website, YouTube, PDF, transcript), and a lecture → topic map. It contains **no copyrighted content**. Classmates download materials from the original sources.

```bash
npx coursecopilot add-pack harvard-cs50x      # registry id
npx coursecopilot add-pack ./my-course.json   # local manifest
npx coursecopilot export-pack eecs376-f26 -o pack.json
npx coursecopilot list-packs
```

`export-pack` keeps public website / YouTube / PDF / transcript URLs. It **drops Canvas, login-gated lecture-capture (leccap), and local files**, and may add a `connect_yourself` placeholder so the importer attaches those themselves.

Registry (in this repo, cached 24h): `COURSECOPILOT_PACK_REGISTRY` or the default [`https://raw.githubusercontent.com/Verdent06/coursecopilot/main/packs/index.json`](https://raw.githubusercontent.com/Verdent06/coursecopilot/main/packs/index.json). Schema: [`packs/schema/pack.schema.json`](packs/schema/pack.schema.json). Contribute a pack: [`CONTRIBUTING-packs.md`](CONTRIBUTING-packs.md). Details: [`docs/packs.md`](docs/packs.md).

Starter packs (open courses only): `harvard-cs50x`, `harvard-cs50p`, `mit-6.006-s20`, `mit-6.042j-f10`, `mit-18.06-s10`, `mit-6.045j-s11`, `mit-6.0001-f16`, `mit-6.034-f10`, `mit-missing-semester`, `stanford-cs229`, `stanford-cs231n`, `berkeley-cs61a`, `cmu-15-445-f25`, `3b1b-linear-algebra`, `umich-eecs376`.

## Connect Canvas

```bash
npx coursecopilot canvas connect
```

Enter your instance URL (any school: `https://umich.instructure.com`, …) and a personal access token from **Account → Settings → Approved Integrations**. The token is stored in `~/.coursecopilot/secrets.json` (mode 0600) or `CANVAS_BASE_URL` / `CANVAS_TOKEN`. It is **never** written to the database, packs, logs, or client MCP configs.

Read-only: courses, files, modules, pages, assignments + due dates, announcements. `add_source` `kind: "canvas"` `uri: "canvas://course/<id>"` indexes pages/files/assignment text. Prompt: `whats_due`.

**If your school blocks tokens** (no “+ New Access Token” button, or `tokens_blocked`): use a public course website, a pack, or download files and add a folder. Details: [docs/canvas.md](docs/canvas.md).

## Tools (M0–M11)

| Tool | Role |
|---|---|
| `ping` | Health check (scaffold) |
| `add_course` | Create a course |
| `list_courses` | List courses, source/chunk counts, exams |
| `set_exam` | Add or replace an exam date |
| `add_source` | Enqueue a source. `website` (robots, same-site crawl, linked PDFs/PPTX), `file`/`folder` (PDF, PPTX, Markdown, TXT), `youtube` (captions with timestamps), `transcript` (VTT/SRT), `canvas` (`canvas://course/<id>`, local token only), `leccap` (UMich CAEN Lecture Capture). |
| `canvas_list_courses` / `_modules` / `_files` / `_pages` / `canvas_get_page` | Live Canvas reads (files fall back to module items on 403) |
| `canvas_list_assignments` / `canvas_list_announcements` | Live due dates and announcements (short cache) |
| `get_ingest_status` | Poll an ingest job (`docs`, `chunks`, `skipped`) |
| `list_sources` | List sources on a course |
| `sync_course` | Incremental re-fetch (unchanged documents skip re-embedding) |
| `remove_source` | Delete a source and its chunks |
| `search_course` | Hybrid keyword + vector search with citations (page, slide, `youtu.be/ID?t=Ns`, or lecture `#t=`) |
| `get_chunk` / `get_document` | Fetch a cited chunk (plus neighbors) or a full document |
| `search` / `fetch` | ChatGPT-compatible aliases of search_course / get_chunk |
| `get_course_outline` | Documents, lectures, topics |
| `set_topics` | Host-labeled topics bound to chunks/keywords |
| `generate_quiz_context` | Grounded chunks + instructions so the **host AI** writes questions (no server LLM) |
| `record_quiz_attempt` | Store graded items and update Beta topic mastery (with forgetting) |
| `get_weak_spots` | Weakest topics plus suggested citations |
| `get_study_plan` | Deterministic review → quiz plan, mixed exam_sim on the last day |
| `add_pack` | Install a pack (registry id, URL, or path). Enqueues sources and applies the topic map |
| `export_pack` | Write a links-only manifest. Drops Canvas, leccap, and local files |
| `list_packs` | Browse the cached registry index and installed packs |

Resources: `coursecopilot://courses`, `coursecopilot://document/{id}`, `coursecopilot://course/{id}/outline`, `coursecopilot://course/{id}/mastery`

Prompts: `quiz_me_on_misses`, `quiz_me`, `study_session`, `exam_prep`, `explain_with_sources`, `add_my_course`, `whats_due`.

YouTube: `add_source` with `kind: "youtube"` and a watch, youtu.be, shorts, embed, or playlist URL. Captions are fetched (English manual, then English auto, then any language). If scraping fails, `yt-dlp` (if on PATH) and then an Internet Archive `youtube-<id>` VTT mirror are tried. Videos without captions are skipped with a pointer to export a VTT/SRT (or v1.1 Whisper). Playlists expand up to 50 videos.

Transcripts: `kind: "transcript"` with a local `.vtt`/`.srt` path or an `http(s)` URL. Caption windows are ~60s, merged to ~350 tokens, and keep `start_s`/`end_s`.

### UMich lecture recordings (under a minute)

```bash
npx coursecopilot login leccap
```

Sign in with your UMich account (Okta + Duo) in the browser that opens. Passwords are never stored. Then `add_source` with `kind: "leccap"` and the Canvas **Lecture Recordings** site URL (`/leccap/site/...`) or a player URL (`/leccap/player/r/...`). Citations look like `EECS 376 – Lecture 10/12 @ 23:14, slide 12` and deep-link to the player. Details: [docs/leccap.md](docs/leccap.md).

## Develop

```bash
npm test          # unit + e2e stdio + e2e HTTP (builds dist/ if needed)
npm run typecheck
npm run lint
```

## License

MIT
