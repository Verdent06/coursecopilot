# How CourseCopilot works

```
Claude / ChatGPT / Gemini / Cursor
        │  MCP (stdio or Streamable HTTP)
        ▼
coursecopilot  ── fetch/index ──► course sites, Canvas, YouTube, files, leccap
        │
        ▼
~/.coursecopilot/cc.db   SQLite + FTS5 + sqlite-vec (optional MiniLM)
```

The **host AI writes every sentence**. This server never calls an LLM. It fetches, parses, chunks (~350 tokens, page/slide/caption boundaries), embeds locally (`Xenova/all-MiniLM-L6-v2`, FTS-only if ONNX fails), retrieves with BM25 + vectors merged by Reciprocal Rank Fusion, and stores quiz mastery (Beta + forgetting).

Transports:

- **stdio** — Claude Desktop, Claude Code, Cursor, Gemini CLI (`npx coursecopilot`)
- **Streamable HTTP** — claude.ai, ChatGPT, Gemini app (`coursecopilot serve --http` + tunnel or a deploy)

Auth on HTTP: secret URL path, bearer token, and single-user OAuth 2.1 + Dynamic Client Registration (needed for Gemini Spark). See [remote.md](remote.md).

More: [SPEC.md](SPEC.md).
