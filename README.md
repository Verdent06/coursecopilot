# CourseCopilot

Your classes, inside the AI you already use. Open-source MCP connector that turns any course (website, Canvas, PDFs, lectures) into cited answers and quizzes in Claude, ChatGPT, and more.

No API key. The host AI does all generation; this server fetches, indexes, retrieves, and stores learning state.

**Status:** M0–M5 (scaffold, database, files, hybrid search, website crawler, YouTube captions + VTT/SRT), **M8 (learning layer)**, and **M9 (remote / HTTP mode)** are implemented. Canvas and packs land in other milestones — see [docs/SPEC.md](docs/SPEC.md).

## Requirements

- Node.js 20 or later

## Run the MCP server (stdio)

```bash
npm install
npm run build
node dist/cli.js
```

With no arguments, `coursecopilot` speaks MCP over stdio (stdout is the protocol; logs go to stderr).

```bash
npm install -g .
coursecopilot
```

Inspect tools locally:

```bash
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

## Tools (M0–M5, M8, M9)

| Tool | Role |
|---|---|
| `ping` | Health check (scaffold) |
| `add_course` | Create a course |
| `list_courses` | List courses, source/chunk counts, exams |
| `set_exam` | Add or replace an exam date |
| `add_source` | Enqueue a source. `website` (robots, same-site crawl, linked PDFs/PPTX), `file`/`folder` (PDF, PPTX, Markdown, TXT), `youtube` (captions with timestamps), `transcript` (VTT/SRT). Canvas lands later. |
| `get_ingest_status` | Poll an ingest job (`docs`, `chunks`, `skipped`) |
| `list_sources` | List sources on a course |
| `sync_course` | Incremental re-fetch (unchanged documents skip re-embedding) |
| `remove_source` | Delete a source and its chunks |
| `search_course` | Hybrid keyword + vector search with citations (page, slide, or `youtu.be/ID?t=Ns`) |
| `get_chunk` / `get_document` | Fetch a cited chunk (plus neighbors) or a full document |
| `search` / `fetch` | ChatGPT-compatible aliases of search_course / get_chunk |
| `get_course_outline` | Documents, lectures, topics |
| `set_topics` | Host-labeled topics bound to chunks/keywords |
| `generate_quiz_context` | Grounded chunks + instructions so the **host AI** writes questions (no server LLM) |
| `record_quiz_attempt` | Store graded items and update Beta topic mastery (with forgetting) |
| `get_weak_spots` | Weakest topics plus suggested citations |
| `get_study_plan` | Deterministic review → quiz plan, mixed exam_sim on the last day |

Resources: `coursecopilot://courses`, `coursecopilot://document/{id}`, `coursecopilot://course/{id}/outline`, `coursecopilot://course/{id}/mastery`

Prompt: `quiz_me_on_misses` (plus `quiz_me`, `study_session`, `exam_prep`, `explain_with_sources`).

YouTube: `add_source` with `kind: "youtube"` and a watch, youtu.be, shorts, embed, or playlist URL. Captions are fetched (English manual, then English auto, then any language). If scraping fails, `yt-dlp` (if on PATH) and then an Internet Archive `youtube-<id>` VTT mirror are tried. Videos without captions are skipped with a pointer to export a VTT/SRT (or v1.1 Whisper). Playlists expand up to 50 videos.

Transcripts: `kind: "transcript"` with a local `.vtt`/`.srt` path or an `http(s)` URL. Caption windows are ~60s, merged to ~350 tokens, and keep `start_s`/`end_s`.

## Develop

```bash
npm test          # unit + e2e stdio + e2e HTTP (builds dist/ if needed)
npm run typecheck
npm run lint
```

## License

MIT
