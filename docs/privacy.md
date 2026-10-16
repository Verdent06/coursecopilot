# Privacy and local-first

CourseCopilot is software someone runs (you, or a classmate who deployed it). There is no telemetry from this repo. A **hosted** deploy (`COURSECOPILOT_HOSTED=1`) creates a CourseCopilot *library* per OAuth user (`/data/users/<id>/`). The operator of that machine can read the volume — deploy your own if that is not acceptable.

## What stays on your machine

- The SQLite index (`~/.coursecopilot/cc.db` locally, or `$COURSECOPILOT_HOME/users/<id>/cc.db` when hosted)
- Quiz attempts, topic mastery, and study-plan inputs
- Canvas token (`~/.coursecopilot/secrets.json` mode 0600, or `CANVAS_TOKEN` in that process's environment)
- Lecture-capture session cookies (`~/.coursecopilot/leccap-session.json`) after `login leccap`
- The MiniLM embedding model cache (`HF_HOME` / `~/.cache/huggingface`)

Nothing is uploaded to a CourseCopilot server. We do not operate one.

## What does leave the machine

1. **Fetches you asked for.** Crawling a course site, downloading a pack's linked PDFs, YouTube caption requests, Canvas REST calls with *your* token, lecture-capture APIs after you signed in.
2. **One-time model download** of `Xenova/all-MiniLM-L6-v2` from Hugging Face (~23 MB). Override with `COURSECOPILOT_MODEL_PATH` for offline use. `coursecopilot doctor` can pre-download it.
3. **Retrieved chunks sent to your AI host.** When Claude, ChatGPT, Gemini, or Cursor calls `search_course` / `fetch`, the matching excerpts go to that vendor under **that vendor's** privacy policy. CourseCopilot does not see the model's reply.

## Remote / HTTP mode

`coursecopilot serve --http --hosted` and one-click deploys (Render / Fly / Railway) isolate each OAuth user. Do not set a shared `CANVAS_TOKEN` on a multi-user host; each student pastes their own token on `/connect/canvas`. Packs never include Canvas or leccap credentials. Secret-path URLs (`/mcp/<token>`) share the operator “local” library and are weaker than OAuth.

Secret-path URLs (`/mcp/<token>`) are weaker than bearer/OAuth: anyone with the URL can use the MCP tools. Prefer a deploy you control and rotate the token.

## Copyright

We index materials for **your own study** and never redistribute lecture content. Course packs are links, metadata, and topic maps only. Each student's machine downloads from the original source (robots.txt and rate limits still apply). Registry CI rejects packs that embed content. Takedown: open an issue with the `pack-takedown` template or a PR deleting `packs/<id>.json`.

## Wipe

```bash
npx coursecopilot wipe --yes                 # deletes cc.db
npx coursecopilot wipe --course <id> --yes   # one course
```

Tokens live in `secrets.json`, not the DB. Delete that file separately if you want the Canvas token gone.
