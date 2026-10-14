# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First public npm / GitHub Release will be **0.1.0** (tag `v0.1.0`). This changelog tracks what landed on `main` before that tag. Publishing (npm, GHCR, GitHub Release assets) is a human step: set `NPM_TOKEN` and push the version tag. The `Release` workflow is not run from pull requests.

### Added

- Hosted remote MCP: `https://<host>/mcp` with OAuth 2.1 (DCR + PKCE), per-user SQLite, landing page (“Add to Claude / ChatGPT / Gemini”), in-chat `get_started` / `connect_canvas` / `connect_leccap` / packs / website / YouTube / upload page, rate limits, `COURSECOPILOT_HOSTED=1` on Docker/Fly/Render.
- MCP server (stdio + Streamable HTTP) with course DB, hybrid search, and citations (M0–M3).
- Ingest: local files/folders, course websites, YouTube captions, VTT/SRT, UMich CAEN lecture capture, read-only Canvas (M2, M4–M6, leccap).
- Course packs, in-repo registry, and 15 starter packs (M7, M11).
- Quizzes, weak spots, study plan (M8).
- Remote mode: bearer, secret path, OAuth + DCR, `coursecopilot tunnel`, Dockerfile, Render / Fly / Railway / Cloudflare Containers (M9, M13).
- `setup` and `doctor` for Claude Desktop, Claude Code, Cursor, Gemini CLI, plus web-client click paths (M10).
- Distribution (M13): npm package metadata, `npm pack` + `npx` smoke, `coursecopilot.mcpb` via `@anthropic-ai/mcpb`, Cursor one-click install badge, GitHub Actions release workflow with provenance.

### Fixed

- `setup` no longer crashes with `ENOENT ~/.coursecopilot/setup-undo.json` on a first run (creates the home dir).
- From a source checkout, `setup` writes the local `node` + `dist/cli.js` path instead of unpublished `npx coursecopilot@latest`.

### Security

- Hosted mode isolates each OAuth user and ignores process-wide `CANVAS_TOKEN` inside a user scope.
- Canvas tokens stay in `~/.coursecopilot/secrets.json` (0600) or process env. Never in the DB, packs, or client MCP JSON.
- HTTP mode disables local file paths unless `--allow-path` and rejects private-network crawls (SSRF guard).

[Unreleased]: https://github.com/Verdent06/coursecopilot/compare/main...HEAD
