# Course packs and the in-repo registry

A pack is a JSON (or YAML) manifest: course id/name/term, http(s) source URLs, and a lecture → topic map. **No copyrighted content** is stored in the pack. `coursecopilot add-pack` downloads materials from the original sources onto the student's machine.

## Registry location

The public registry is this repository, not a separate `coursecopilot-packs` repo:

| File | Role |
|---|---|
| `packs/index.json` | Generated catalog (`id`, `name`, `term`, `institution`, `version`, `source_count`, `verified`, `url`) |
| `packs/<id>.json` | One manifest per pack (id must match the filename stem) |
| `packs/schema/pack.schema.json` | JSON Schema 2020-12 |

Default index URL (cached 24h under `$COURSECOPILOT_HOME/cache/registry-index.json`):

`https://raw.githubusercontent.com/Verdent06/coursecopilot/main/packs/index.json`

Override with `COURSECOPILOT_PACK_REGISTRY` or `add-pack --registry <url>`.

## CLI / tools

```bash
npx coursecopilot add-pack harvard-cs50x          # registry id
npx coursecopilot add-pack ./my-course.json       # local path
npx coursecopilot add-pack https://example.edu/pack.json
npx coursecopilot list-packs
npx coursecopilot export-pack <course-id> -o pack.json
```

MCP tools `add_pack`, `list_packs`, and `export_pack` do the same. `export-pack` drops Canvas, leccap / lecture-capture, and local files, and may add `connect_yourself` placeholders.

## Starter packs

Shipped packs are openly available courses (OCW, CS50, public course sites, YouTube). Topic maps follow each course's published lecture list. UMich EECS 376 points only at public `eecs376.org` / notes pages; leccap and Canvas are `connect_yourself` placeholders.

How to contribute: [CONTRIBUTING-packs.md](../CONTRIBUTING-packs.md).
