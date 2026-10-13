# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First public npm / GitHub Release will be **0.1.0** (tag `v0.1.0`). This changelog tracks what landed on `main` before that tag. Publishing (npm, GHCR, GitHub Release assets) is a human step: set `NPM_TOKEN` and push the version tag. The `Release` workflow is not run from pull requests.

### Added

- MCP server (stdio + Streamable HTTP) with course DB, hybrid search, and citations (M0–M3).
- Ingest: local files/folders, course websites, YouTube captions, VTT/SRT, UMich CAEN lecture capture, read-only Canvas (M2, M4–M6, leccap).
- Course packs, in-repo registry, and 15 starter packs (M7, M11).
- Quizzes, weak spots, study plan (M8).
- Remote mode: bearer, secret path, OAuth + DCR, `coursecopilot tunnel`, Dockerfile, Render / Fly / Railway / Cloudflare Containers (M9, M13).
- `setup` and `doctor` for Claude Desktop, Claude Code, Cursor, Gemini CLI, plus web-client click paths (M10).
- Distribution (M13): npm package metadata, `npm pack` + `npx` smoke, `coursecopilot.mcpb` via `@anthropic-ai/mcpb`, Cursor one-click install badge, GitHub Actions release workflow with provenance.

### Security

- Canvas tokens stay in `~/.coursecopilot/secrets.json` (0600) or process env. Never in the DB, packs, or client MCP JSON.
- HTTP mode disables local file paths unless `--allow-path` and rejects private-network crawls (SSRF guard).

[Unreleased]: https://github.com/Verdent06/coursecopilot/compare/main...HEAD
