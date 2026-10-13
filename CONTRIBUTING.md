# Contributing

CourseCopilot is an MCP server: **the host AI generates**, this repo fetches, indexes, retrieves, and stores learning state. Pull requests that add an LLM SDK (`openai`, `@anthropic-ai/sdk`, `@google/genai`, …) will fail CI.

## Develop

Need **Node.js 20+**.

```bash
npm ci
npm run build
npm test
npm run lint
npm run typecheck
```

`npm test` runs unit, integration, and MCP e2e (stdio + HTTP). It builds `dist/` if needed. Data during tests goes to a temp `COURSECOPILOT_HOME`.

Helpful checks:

```bash
npm run check:no-llm
npm run check:cursor-link
npm pack --dry-run
npm run pack:mcpb
npm run docs:tools:check
```

Native modules (`better-sqlite3`, `sqlite-vec`, `onnxruntime-node`) use prebuilds. If a platform has no prebuild, search degrades to FTS-only rather than crashing. CI is Ubuntu, macOS, and `windows-2022` × Node 20 and 22.

## Layout

See [docs/SPEC.md](docs/SPEC.md) §15 and [docs/architecture.md](docs/architecture.md). One tool per file under `src/server/tools/` with a doc comment — `scripts/gen-tools-doc.ts` builds [docs/tools.md](docs/tools.md).

## Course packs

Packs are **links and metadata only**. Do not commit lecture notes, slides, transcripts, or other course content.

- Guide: [CONTRIBUTING-packs.md](CONTRIBUTING-packs.md)
- Schema: `packs/schema/pack.schema.json`
- After adding `packs/<id>.json`, run `npm run packs:index` and `npm run packs:validate`

Takedown: open an issue with the **Pack takedown** template, or a PR that deletes the pack file and regenerates `packs/index.json`.

## What not to add

- LLM API calls or hosted models
- Canvas writes, grades, or OAuth-for-other-people
- Redistributing course files inside packs
- Secrets, Canvas tokens, or lecture-capture cookies

## PRs

One milestone-sized change per PR. Keep CI green. Mark anything you could not verify against a live MCP client in the PR body.

License: MIT (see [LICENSE](LICENSE)).
