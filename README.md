# CourseCopilot

Your classes, inside the AI you already use. Open-source MCP connector that turns any course (website, Canvas, PDFs, lectures) into cited answers and quizzes in Claude, ChatGPT, and more.

No API key. The host AI does all generation; this server fetches, indexes, retrieves, and stores learning state.

**Status:** milestones M0 (scaffold), M1 (database + courses), and M2 (files pipeline) are implemented. Search, website crawl, and quiz/study tools land in later milestones — see [docs/SPEC.md](docs/SPEC.md).

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

## Tools (M0–M2)

| Tool | Role |
|---|---|
| `ping` | Health check (scaffold) |
| `add_course` | Create a course |
| `list_courses` | List courses, source/chunk counts, exams |
| `set_exam` | Add or replace an exam date |
| `add_source` | Enqueue a file or folder (PDF, PPTX, Markdown, TXT). Other kinds land in later milestones. |
| `get_ingest_status` | Poll an ingest job (`docs`, `chunks`, `skipped`) |
| `list_sources` | List sources on a course |
| `remove_source` | Delete a source and its chunks |

Resource: `coursecopilot://courses`

## Develop

```bash
npm test          # unit + e2e stdio (builds dist/ if needed)
npm run typecheck
npm run lint
```

## License

MIT
