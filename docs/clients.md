# Client compatibility matrix

Launch is gated on [SPEC.md §16](SPEC.md) milestone **M12**: the same demo flow (`search_course` with a citation, `quiz_me_on_misses`, `record_quiz_attempt`, `canvas_list_assignments`) on every surface below.

Until M12 is filled in with screenshots, treat this table as the **intended** support list. Setup and HTTP protocol tests live in CI; live vendor UIs do not.

| Client | Transport | Install | Status | Notes |
|---|---|---|---|---|
| Claude Desktop | stdio | `npx coursecopilot setup` or `.mcpb` | protocol ✅ | JSON + MCPB. Restart the app fully. |
| claude.ai web / mobile | HTTP | `setup --remote` or a deploy, then Connectors → Custom → Web | protocol ✅ | Public HTTPS. Free plan: 1 custom connector. |
| Claude Code | stdio | `claude mcp add -s user coursecopilot -- npx -y coursecopilot@latest` | protocol ✅ | Or `npx coursecopilot setup`. |
| Cursor | stdio | setup, deeplink / badge, or `~/.cursor/mcp.json` | protocol ✅ | |
| ChatGPT | HTTP | developer mode → Add custom MCP server | protocol ✅ | **Plan-gated.** Pro is read/fetch only; recording a quiz may need Claude/Cursor or Business/Enterprise/Edu. |
| Gemini CLI | stdio | `gemini mcp add -s user coursecopilot npx -y coursecopilot@latest` | protocol ✅ | Primary Gemini path; no eligibility gates. |
| Gemini app (Spark custom apps) | HTTP + OAuth | Settings → Connected Apps → Custom apps for Spark | protocol ✅ | **Personal Google accounts only** (not work/school). US, 18+, English, Keep Activity on. School logins: use Gemini CLI. |
| Google AI Studio | — | unsupported | ❌ | No MCP client. |

`protocol ✅` means CI speaks MCP `initialize` + `tools/list` over that transport. Vendor-UI confirmation is M12.
