# CourseCopilot

Your classes, inside the AI you already use. Open-source MCP connector that turns any course (website, Canvas, PDFs, lectures) into cited answers and quizzes in Claude, ChatGPT, and more.

No API key. The host AI does all generation; this server fetches, indexes, retrieves, and stores learning state.

**Status:** milestones M0–M3 (scaffold, database, files, hybrid search), **M5 (YouTube captions + VTT/SRT)**, and **M8 (learning layer)** are implemented. Website crawl, Canvas, packs, and remote HTTP land in other milestones — see [docs/SPEC.md](docs/SPEC.md).

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

## Tools (M0–M3, M5, M8)

| Tool | Role |
|---|---|
| `ping` | Health check (scaffold) |
| `add_course` | Create a course |
| `list_courses` | List courses, source/chunk counts, exams |
| `set_exam` | Add or replace an exam date |
| `add_source` | Enqueue a source. `file`/`folder` (PDF, PPTX, Markdown, TXT), `youtube` (captions with timestamps), `transcript` (VTT/SRT). Website and Canvas land later. |
| `get_ingest_status` | Poll an ingest job (`docs`, `chunks`, `skipped`) |
| `list_sources` | List sources on a course |
| `remove_source` | Delete a source and its chunks |
| `search_course` | Hybrid keyword + vector search with citations (page, slide, or `youtu.be/ID?t=Ns`) |
| `get_chunk` / `get_document` | Fetch a cited chunk (plus neighbors) or a full document |
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
npm test          # unit + e2e stdio (builds dist/ if needed)
npm run typecheck
npm run lint
```

## License

MIT
