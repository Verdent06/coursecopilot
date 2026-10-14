# CourseCopilot

**Your classes inside the AI you already use, free. Share a course in one line.**

Course packs for your AI. Any course website (or your Canvas course) becomes a cited, quiz-tracking tutor in Claude, ChatGPT, Gemini, and Cursor that you can share with your class.

No API key. The host AI does all the writing; this server fetches, indexes, retrieves, and remembers what you missed.

[![CI](https://github.com/Verdent06/coursecopilot/actions/workflows/ci.yml/badge.svg)](https://github.com/Verdent06/coursecopilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Install MCP Server in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=coursecopilot&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNvdXJzZWNvcGlsb3RAbGF0ZXN0Il19)

![CourseCopilot demo placeholder](docs/assets/demo-placeholder.svg)

> **Demo GIF/video (placeholder).** Milestone M14 records the 20-second walkthrough: `setup` → `add-pack` → “quiz me on what I missed” with a clickable slide citation, then the same weak spot in ChatGPT / Gemini. Until then this card stands in.

## Works with

| Client | How | Notes |
|---|---|---|
| **Claude Desktop** | `npx coursecopilot setup` or double-click `coursecopilot.mcpb` | Local stdio |
| **claude.ai** | Custom connector → Web → paste HTTPS URL | Remote. Free plan: 1 custom connector |
| **Claude Code** | `claude mcp add -s user coursecopilot -- npx -y coursecopilot@latest` | Local stdio |
| **Cursor** | setup, or the badge above | Local stdio |
| **ChatGPT** | Developer mode → Add custom MCP server | Remote. **Plan-gated** (see below) |
| **Gemini CLI** | `gemini mcp add -s user coursecopilot npx -y coursecopilot@latest` | Local stdio; no eligibility gates |
| **Gemini app** | Spark → Custom apps → paste HTTPS URL | Remote. **Personal Google accounts only** |

Status details: [docs/clients.md](docs/clients.md). Google AI Studio has no MCP client.

## Quick start (30 seconds)

```bash
npx coursecopilot setup
npx coursecopilot add-pack harvard-cs50x
```

Then ask: **quiz me on what I missed.**

`setup` detects Claude Desktop, Claude Code, Cursor, and Gemini CLI, backs up each config, and merges `mcpServers.coursecopilot`. For claude.ai / ChatGPT / the Gemini app it prints the click path (or start a tunnel with `--remote`).

```bash
npx coursecopilot doctor            # Node, native modules, DB, clients, Canvas, registry
npx coursecopilot setup --undo      # restore the last config backups
```

### Per client

**Claude Desktop.** `npx coursecopilot setup` (or `--client claude-desktop`). Restart Claude fully. Or download `coursecopilot.mcpb` from [Releases](https://github.com/Verdent06/coursecopilot/releases) and double-click it (Settings → Extensions → Advanced → Install Extension). Optional MCPB fields: Canvas URL + token (sensitive); prefer `canvas connect`.

**claude.ai.** `npx coursecopilot setup --remote` (or a [Deploy to Render](https://render.com/deploy?repo=https://github.com/Verdent06/coursecopilot) button). Then **Customize → Connectors → Add → Custom → Web** → paste `https://<host>/mcp/<secret>` → Authentication: No sign in.

**Claude Code.**

```bash
claude mcp add -s user coursecopilot -- npx -y coursecopilot@latest
```

**Cursor.** Click the badge at the top, or:

```bash
npx coursecopilot setup --client cursor
```

Manual: the same JSON under `mcpServers` in `~/.cursor/mcp.json`.

**ChatGPT.** Needs a **plan with developer mode** — check [OpenAI's page](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt). We did not confirm Free/Plus. **Pro is read/fetch only**; recording a quiz may need Claude/Cursor or Business/Enterprise/Edu. Enable developer mode → Plugins → + → Add custom MCP server → paste `https://<host>/mcp/<secret>`.

**Gemini CLI.**

```bash
gemini mcp add -s user coursecopilot npx -y coursecopilot@latest
```

**Gemini app.** Spark custom apps only. **Personal Google account** (not work/school — a `umich.edu` login will not work), US, 18+, English, Keep Activity on. Add on the web: Settings & help → Connected Apps → Custom apps for Spark → URL `https://<host>/mcp` (OAuth). School accounts: use Gemini CLI.

Full click paths: [docs/install.md](docs/install.md) · [docs/remote.md](docs/remote.md).

## Remote / always-on (claude.ai, ChatGPT, Gemini app)

Those clients connect from the vendor's cloud, so the server must be public HTTPS.

```bash
npx coursecopilot setup --remote    # serve --http + Cloudflare tunnel (hostname changes each run)
```

One-click always-on (your instance, your volume, your token):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Verdent06/coursecopilot)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new?template=https://github.com/Verdent06/coursecopilot)

Fly: `fly launch --config deploy/fly.toml`. Image: `ghcr.io/verdent06/coursecopilot` (published on version tags). Dockerfile at the repo root.

## Features

| | |
|---|---|
| **Files** | PDF (per-page), PPTX (slides + notes), Markdown, TXT, folders |
| **Websites** | robots.txt, same-site crawl, linked PDFs/PPTX, incremental sync |
| **YouTube** | Captions with timestamps and `youtu.be?t=` citations; VTT/SRT import |
| **UMich lecture capture** | `login leccap` (you sign in; passwords never stored), slide + caption citations |
| **Canvas** | Read-only: courses, files, modules, pages, assignments + due dates, announcements. Your token, local only |
| **Course packs + registry** | One-line `add-pack <id>`. Links and topic maps only — no copyrighted content |
| **Quizzes / weak spots** | Host AI writes questions from cited chunks; we record attempts and rank what to restudy |

## Connect Canvas

```bash
npx coursecopilot canvas connect
```

Account → Settings → Approved Integrations → + New Access Token. Stored in `~/.coursecopilot/secrets.json` (0600). **Never** written to the database, packs, logs, or client MCP configs.

If your school blocks tokens: use a public course website, a pack, or download files and `add_source` a folder. Details: [docs/canvas.md](docs/canvas.md).

## Browse packs

```bash
npx coursecopilot add-pack harvard-cs50x
npx coursecopilot list-packs
npx coursecopilot export-pack eecs376-f26 -o pack.json
```

| Pack | Course |
|---|---|
| `harvard-cs50x` / `harvard-cs50p` | CS50 / CS50 Python |
| `mit-6.006-s20` `mit-6.042j-f10` `mit-18.06-s10` `mit-6.045j-s11` `mit-6.0001-f16` `mit-6.034-f10` `mit-missing-semester` | MIT OCW / Missing Semester |
| `stanford-cs229` `stanford-cs231n` | Stanford public notes |
| `berkeley-cs61a` | SICP |
| `cmu-15-445-f25` | Intro to Database Systems |
| `3b1b-linear-algebra` | 3Blue1Brown |
| `umich-eecs376` | Public eecs376.org (Canvas / leccap are `connect_yourself`) |

Don't see your course? Add the website, `export-pack`, and open a PR. Guide: [CONTRIBUTING-packs.md](CONTRIBUTING-packs.md). Schema: [`packs/schema/pack.schema.json`](packs/schema/pack.schema.json).

`export-pack` **drops Canvas, lecture-capture, and local files**. Classmates attach those themselves.

## Add any course

```json
{ "name": "add_source", "arguments": { "course_id": "eecs376-f26", "kind": "website", "uri": "https://eecs376.org/" } }
```

Kinds: `website`, `file`, `folder`, `youtube`, `transcript`, `canvas` (`canvas://course/<id>`), `leccap`. Then `search_course`, `generate_quiz_context`, `record_quiz_attempt`, `get_weak_spots`.

UMich recordings: `npx coursecopilot login leccap` then `kind: "leccap"`. [docs/leccap.md](docs/leccap.md).

## Share with your class

1. `npx coursecopilot export-pack <course-id> -o packs/<id>.json`
2. Open a PR. CI validates the schema and rejects embedded content.
3. Classmates run `npx coursecopilot add-pack <id>` and download materials **from the original sources**.

## Privacy (local-first)

All data lives in `~/.coursecopilot/`. No telemetry. Nothing leaves the machine except fetches to sources you added, a one-time Hugging Face model download (override with `COURSECOPILOT_MODEL_PATH`), and **retrieved chunks sent to whichever AI you chose** (that vendor's privacy policy). Canvas tokens stay on the process you run. Packs never contain lecture content. Full write-up: [docs/privacy.md](docs/privacy.md).

## How it works

The host AI generates. CourseCopilot indexes locally (SQLite + FTS5 + MiniLM vectors) and returns cited chunks. No LLM SDK is in this repo. [docs/architecture.md](docs/architecture.md).

## Comparison

| | CourseCopilot | NotebookLM | BetterCampus | CourseMCP / canvas-mcp |
|---|---|---|---|---|
| Inside Claude / ChatGPT / Gemini / Cursor | Yes | Separate app | Browser extension | MCP, Canvas-only |
| Any course site + files + YouTube | Yes | Manual upload | LMS UI | Canvas |
| Shareable packs (links only) | Yes | No | No | No |
| Quizzes + weak spots by concept | Yes | Per deck | Study sets | No |
| Price | Free, MIT | Free | Pro $19/mo | Free (wrappers) |

## Tools

Auto-generated reference: **[docs/tools.md](docs/tools.md)**. Prompts include `quiz_me_on_misses`, `whats_due`, `exam_prep`.

## Troubleshooting

```bash
npx coursecopilot doctor
npx coursecopilot doctor --json
```

- Setup refused to write: existing JSON is invalid — paste the snippet or `--undo`.
- Client doesn't see the server: restart Claude / reload Cursor MCP / `/mcp` in Claude Code or Gemini CLI.
- Native module errors: `npm rebuild better-sqlite3 sqlite-vec`. Search still works keyword-only.
- Tunnel hostname changed: quick tunnels do that; use Render / Fly / Railway for a stable URL.

## FAQ

**Does CourseCopilot call an LLM?** No. Claude / ChatGPT / Gemini / Cursor write the answers. CI fails if an LLM SDK appears in dependencies.

**Where is my data?** `~/.coursecopilot/` on the machine (or volume) running the server. See [docs/privacy.md](docs/privacy.md).

**Will my Canvas token leak?** It lives in `secrets.json` (0600) or env on *your* process. It is never in packs, the DB, logs, or client MCP JSON. Do not paste it into a server someone else runs.

**ChatGPT Free/Plus?** Unknown. You need a plan with developer mode. Pro can call read/fetch tools only.

**Can I use the Gemini app with a school Google account?** No. Spark custom apps are personal-accounts-only. Use Gemini CLI.

**What is in a pack?** Links, metadata, and a topic map. Not slides, not transcripts, never Canvas.

**npm name?** `coursecopilot` (unscoped). First publish is the human tagging `v0.1.0` with `NPM_TOKEN` set.

## Contributing

Code: [CONTRIBUTING.md](CONTRIBUTING.md). Packs: [CONTRIBUTING-packs.md](CONTRIBUTING-packs.md). Roadmap: OAuth polish, local Whisper, Playwright for JS-only sites — [docs/SPEC.md](docs/SPEC.md).

## License

MIT
