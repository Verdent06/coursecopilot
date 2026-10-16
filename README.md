# CourseCopilot

**Your classes inside Claude, ChatGPT, and Gemini. Paste one URL. No terminal.**

Any course website (or your Canvas course) becomes a cited, quiz-tracking tutor in the AI you already use. Share a course with your class as a one-line pack.

No API key. The host AI writes; this server fetches, indexes, retrieves, and remembers what you missed.

[![CI](https://github.com/Verdent06/coursecopilot/actions/workflows/ci.yml/badge.svg)](https://github.com/Verdent06/coursecopilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Paste this URL

After you (or a classmate) deploy CourseCopilot, the connector URL is:

```
https://<your-host>/mcp
```

That is the only thing Claude, ChatGPT, and the Gemini app need. Everything else — Canvas, lecture capture, packs, websites, YouTube, file upload — happens **in chat**.

Open the deploy’s home page (`https://<your-host>/`) for copy-paste instructions.

### Add to Claude (claude.ai / desktop / mobile)

1. Customize → Connectors → Add → Custom → **Web**.
2. Paste `https://<your-host>/mcp`.
3. Authentication: **Sign in now** (OAuth). Approve the CourseCopilot page.
4. In chat: **get started**.

Free plan: 1 custom connector. Docs: [Custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### Add to ChatGPT

1. Enable **developer mode** (plan-gated — check [OpenAI’s page](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)).
2. Plugins → + → Add custom MCP server.
3. Server URL: `https://<your-host>/mcp` with OAuth.

Pro is often **read/fetch only**; recording a quiz may need Claude or a Business/Edu plan.

### Add to Gemini (app)

1. On the **web**: Settings & help → Connected Apps → Custom apps for Spark.
2. Paste `https://<your-host>/mcp`. Spark requires OAuth + Dynamic Client Registration.

**Personal Google account only** (not work/school — a `umich.edu` login will not work), US, 18+, English, Keep Activity on. School accounts: use Gemini CLI in [Advanced](#advanced--self-host--local).

## Then, in chat

Ask **get started**. The assistant will offer:

| In chat | What it does |
|---|---|
| `get_started` | What’s already in your library, and the next step |
| `browse_packs` / `add_course_pack` | Public packs (CS50, MIT OCW, …) — links only |
| `add_course_website` | Crawl a public syllabus site |
| `add_youtube` | Index captions (timestamps + `youtu.be?t=`) |
| `connect_canvas` | Calendar feed first (no token), then the browser extension, then an optional personal token |
| `connect_leccap` | Same extension (no cookie copy); cookie paste remains a fallback |
| `upload_files` | Hosted upload page for PDF / PPTX / MD / TXT |

Then: **quiz me on what I missed.**

## Deploy your own (one click)

There is no official public CourseCopilot host yet. You deploy one instance; **OAuth gives each person their own isolated SQLite library** on that instance.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Verdent06/coursecopilot)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new?template=https://github.com/Verdent06/coursecopilot)

```bash
# Fly.io
fly launch --config deploy/fly.toml
fly volumes create cc_data --size 2
fly secrets set COURSECOPILOT_SESSION_SECRET=$(openssl rand -hex 32)
fly secrets set COURSECOPILOT_PUBLIC_URL=https://<app>.fly.dev
fly deploy
```

Image: `ghcr.io/verdent06/coursecopilot` (on version tags). Dockerfile at the repo root. Persistent volume on `/data`. Set `COURSECOPILOT_HOSTED=1` (default in the image).

**Accounts / secrets you need to actually deploy**

| | |
|---|---|
| Render / Fly / Railway account | To run the container |
| Persistent disk | `/data` (`COURSECOPILOT_HOME`) — user libraries + MiniLM cache |
| `COURSECOPILOT_PUBLIC_URL` | `https://<app>.onrender.com` or `https://<app>.fly.dev` (OAuth issuer) |
| `COURSECOPILOT_SESSION_SECRET` | Signs connect/upload links and the library cookie |
| Optional `COURSECOPILOT_TOKEN` | Admin bearer / secret-path for your own debugging |
| Do **not** set a shared `CANVAS_TOKEN` on a multi-user host | Each user connects via ICS / extension / their own token |

After deploy, open `https://<host>/` and paste `https://<host>/mcp` into Claude / ChatGPT / Gemini.

Details: [docs/remote.md](docs/remote.md).

## Features

| | |
|---|---|
| **Files** | PDF (per-page), PPTX (slides + notes), Markdown, TXT — via the upload page in chat |
| **Websites** | robots.txt, same-site crawl, linked PDFs/PPTX |
| **YouTube** | Captions with timestamps |
| **UMich lecture capture** | Browser extension (session APIs) or cookie handoff |
| **Canvas** | Works **without** a personal token: ICS calendar feed (due dates) + optional MV3 extension (full read) |
| **Course packs** | One-line `add_course_pack harvard-cs50x`. Links only — no copyrighted content |
| **Quizzes / weak spots** | Host AI writes questions from cited chunks; we record attempts |

## Canvas and lecture capture (in chat)

`connect_canvas` — many schools (including UMich) **block student access tokens**. You do not need one:

1. **Calendar feed (zero setup).** Canvas → Calendar → Calendar Feed → paste the ICS URL on the hosted page (never in chat). Due dates across every course.
2. **Browser extension (full read).** Install [CourseCopilot Sync](extension/README.md) (Chrome / Edge / Firefox, MV3). Pair it with the one-time code from chat while signed into Canvas via SSO. Read-only; you click Sync.
3. **Personal token (optional)** if Account → Settings still shows + New Access Token.

[docs/canvas.md](docs/canvas.md).

`connect_leccap` uses the **same extension** for captions + slide timeline (product / webvtt APIs, no cookie copying). Cookie paste remains a fallback. [docs/leccap.md](docs/leccap.md).

## Browse packs

In chat: `browse_packs` then `add_course_pack harvard-cs50x`.

| Pack | Course |
|---|---|
| `harvard-cs50x` / `harvard-cs50p` | CS50 / CS50 Python |
| `mit-6.006-s20` `mit-6.042j-f10` `mit-18.06-s10` `mit-6.045j-s11` `mit-6.0001-f16` `mit-6.034-f10` `mit-missing-semester` | MIT OCW / Missing Semester |
| `stanford-cs229` `stanford-cs231n` | Stanford public notes |
| `berkeley-cs61a` | SICP |
| `cmu-15-445-f25` | Intro to Database Systems |
| `3b1b-linear-algebra` | 3Blue1Brown |
| `umich-eecs376` | Public eecs376.org (Canvas / leccap are `connect_yourself`) |

Guide: [CONTRIBUTING-packs.md](CONTRIBUTING-packs.md).

## Privacy

On a **hosted** deploy, each OAuth user gets `$COURSECOPILOT_HOME/users/<id>/` (SQLite, Canvas token, leccap cookies). The operator of that instance can read the volume — deploy your own if that matters. No telemetry. Retrieved chunks go to whichever AI you connected (that vendor’s policy). Packs never contain lecture content. [docs/privacy.md](docs/privacy.md).

## How it works

The host AI generates. CourseCopilot indexes (SQLite + FTS5 + MiniLM) and returns cited chunks. No LLM SDK is in this repo. [docs/architecture.md](docs/architecture.md).

## Comparison

| | CourseCopilot | NotebookLM | BetterCampus | CourseMCP / canvas-mcp |
|---|---|---|---|---|
| Inside Claude / ChatGPT / Gemini / Cursor | Yes | Separate app | Browser extension | MCP, Canvas-only |
| Any course site + files + YouTube | Yes | Manual upload | LMS UI | Canvas |
| Shareable packs (links only) | Yes | No | No | No |
| Quizzes + weak spots by concept | Yes | Per deck | Study sets | No |
| Price | Free, MIT | Free | Pro $19/mo | Free (wrappers) |

## Tools

Auto-generated reference: **[docs/tools.md](docs/tools.md)**. Prompts include `get_started`, `quiz_me_on_misses`, `whats_due`, `exam_prep`.

---

## Advanced / self-host / local

Use this if you want Claude Desktop, Cursor, Claude Code, or Gemini CLI on your laptop without a public URL. **You will need Node ≥ 20.** The npm package name `coursecopilot` is not published yet; from a git checkout, `setup` writes the local `node` + `dist/cli.js` path (or set `COURSECOPILOT_SETUP_NPX=1` after publish).

[![Install MCP Server in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=coursecopilot&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNvdXJzZWNvcGlsb3RAbGF0ZXN0Il19)

```bash
npm install
npm run build
node dist/cli.js setup
node dist/cli.js add-pack harvard-cs50x
node dist/cli.js doctor
```

`setup` detects Claude Desktop, Claude Code, Cursor, and Gemini CLI, backs up each config, and merges `mcpServers.coursecopilot`. After npm publish you can use `npx coursecopilot setup` instead.

```bash
node dist/cli.js setup --undo
node dist/cli.js serve --http --port 8787          # single-user on this machine
node dist/cli.js serve --http --hosted             # multi-user (needs a public URL)
node dist/cli.js canvas connect                    # local secrets.json
node dist/cli.js login leccap                      # headed Playwright + Duo
```

**Claude Code** (after publish): `claude mcp add -s user coursecopilot -- npx -y coursecopilot@latest`

**Gemini CLI** (after publish): `gemini mcp add -s user coursecopilot npx -y coursecopilot@latest`

**Cursor:** the badge above, or `node dist/cli.js setup --client cursor`.

Local configs use stdio. Web clients still need the hosted `/mcp` URL.

Troubleshooting: `node dist/cli.js doctor`. Native module errors: `npm rebuild better-sqlite3 sqlite-vec`. Full click paths: [docs/install.md](docs/install.md).

## FAQ

**Does CourseCopilot call an LLM?** No. Claude / ChatGPT / Gemini / Cursor write the answers.

**Do I need a terminal?** Not for the primary path. Deploy (or use someone’s deploy), paste `https://<host>/mcp`, then stay in chat.

**My school blocks Canvas tokens.** That is the default path now: calendar feed (due dates) or the browser extension (full read). A personal token is optional.

**Will my Canvas token / calendar feed leak?** On a host you do not control, the operator can read the volume. Prefer your own Render/Fly instance. Secrets are never in packs or logs. The extension never uploads cookies.

**ChatGPT Free/Plus?** Unknown. You need a plan with developer mode.

**Gemini with a school Google account?** No. Use Gemini CLI (Advanced) or Claude.

**What is in a pack?** Links, metadata, and a topic map. Not slides, not transcripts, never Canvas.

## Contributing

Code: [CONTRIBUTING.md](CONTRIBUTING.md). Packs: [CONTRIBUTING-packs.md](CONTRIBUTING-packs.md). Roadmap: [docs/SPEC.md](docs/SPEC.md).

## License

MIT
