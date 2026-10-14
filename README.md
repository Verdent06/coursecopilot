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
| `connect_canvas` | Opens a **hosted page** — paste Canvas URL + token there, never in chat |
| `connect_leccap` | UMich lecture capture via a hosted cookie-handoff page |
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
| Do **not** set a shared `CANVAS_TOKEN` on a multi-user host | Each user pastes their own token on the connect page |

After deploy, open `https://<host>/` and paste `https://<host>/mcp` into Claude / ChatGPT / Gemini.

Details: [docs/remote.md](docs/remote.md).

## Features

| | |
|---|---|
| **Files** | PDF (per-page), PPTX (slides + notes), Markdown, TXT — via the upload page in chat |
| **Websites** | robots.txt, same-site crawl, linked PDFs/PPTX |
| **YouTube** | Captions with timestamps |
| **UMich lecture capture** | Cookie handoff (see limits below) |
| **Canvas** | Read-only: courses, files, modules, pages, assignments + due dates, announcements |
| **Course packs** | One-line `add_course_pack harvard-cs50x`. Links only — no copyrighted content |
| **Quizzes / weak spots** | Host AI writes questions from cited chunks; we record attempts |

## Canvas and lecture capture (in chat)

`connect_canvas` returns a link. Create a token at Canvas → Account → Settings → Approved Integrations → + New Access Token. It is stored only in **your** library on the host (`secrets.json`, 0600). If your school blocks tokens: use a website, a pack, or the upload page. [docs/canvas.md](docs/canvas.md).

`connect_leccap` is a **cookie handoff**. UMich Weblogin + Duo cannot run on the server. Practical path: export cookies from a signed-in `leccap.engin.umich.edu` tab (Cookie-Editor → Playwright storageState or `cookies.txt`, including HttpOnly `umich.edu` cookies) and paste them on the hosted page. A bookmarklet only sees non-HttpOnly cookies and is often not enough. [docs/leccap.md](docs/leccap.md).

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

**Will my Canvas token leak?** On a host you do not control, the operator can read the volume. Prefer your own Render/Fly instance. Tokens are never in packs or logs.

**ChatGPT Free/Plus?** Unknown. You need a plan with developer mode.

**Gemini with a school Google account?** No. Use Gemini CLI (Advanced) or Claude.

**What is in a pack?** Links, metadata, and a topic map. Not slides, not transcripts, never Canvas.

## Contributing

Code: [CONTRIBUTING.md](CONTRIBUTING.md). Packs: [CONTRIBUTING-packs.md](CONTRIBUTING-packs.md). Roadmap: [docs/SPEC.md](docs/SPEC.md).

## License

MIT
