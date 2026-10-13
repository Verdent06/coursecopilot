# Privacy and local-first

CourseCopilot is software you run. There is no central hosted service, no telemetry, and no CourseCopilot account.

## What stays on your machine

- The SQLite index (`~/.coursecopilot/cc.db`, override with `COURSECOPILOT_HOME`)
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

`coursecopilot serve --http` and one-click deploys (Render / Fly / Railway / Cloudflare Containers) are **your** instance. Canvas tokens, if set, stay in that instance's env. Do not paste a Canvas token into a server someone else runs. Packs never include Canvas or leccap credentials.

Secret-path URLs (`/mcp/<token>`) are weaker than bearer/OAuth: anyone with the URL can use the MCP tools. Prefer a deploy you control and rotate the token.

## Copyright

We index materials for **your own study** and never redistribute lecture content. Course packs are links, metadata, and topic maps only. Each student's machine downloads from the original source (robots.txt and rate limits still apply). Registry CI rejects packs that embed content. Takedown: open an issue with the `pack-takedown` template or a PR deleting `packs/<id>.json`.

## Wipe

```bash
npx coursecopilot wipe --yes                 # deletes cc.db
npx coursecopilot wipe --course <id> --yes   # one course
```

Tokens live in `secrets.json`, not the DB. Delete that file separately if you want the Canvas token gone.
