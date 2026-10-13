# Contributing course packs

Packs live **in this repo** under `packs/`. There is no separate registry repository. A pack is a small JSON manifest: course metadata, **http(s) source URLs**, and a lecture → topic map. It must not contain lecture text, slides, transcripts, or other course content.

Classmates install with:

```bash
npx coursecopilot add-pack umich-eecs376
```

That resolves `packs/index.json` from GitHub (`https://raw.githubusercontent.com/Verdent06/coursecopilot/main/packs/index.json`), downloads the matching `packs/<id>.json`, and ingests the linked sources on the student's machine.

## Add a pack (PR)

1. Index the course locally (`add_source` for the public website / YouTube / PDFs).
2. Export a links-only manifest:

   ```bash
   npx coursecopilot export-pack <course-id> -o packs/<id>.json
   ```

3. Name the file `packs/<id>.json` where `<id>` is the pack's `id` (lowercase slug). YAML (`.yaml`/`.yml`) is accepted by the importer; the registry ships JSON.
4. Fill in `institution`, `term`, `license_note`, and a **topic map taken from the course's own lecture list**.
5. Run:

   ```bash
   npm run packs:index
   npm run packs:validate
   ```

6. Open a pull request. Do not embed course content. Do not include Canvas, leccap/lecture-capture, or local `file://` URLs (`export-pack` already drops those and may add a `connect_yourself` placeholder).

## What CI checks

On every PR:

- Every `packs/<id>.json` is validated against `packs/schema/pack.schema.json` (and the runtime zod schema): id matches filename, http(s) URLs only, ≤500 sources, no embedded content / data URIs / huge base64 blobs, no duplicate ids.
- `packs/index.json` must match a fresh generation from the pack files. If you forget `npm run packs:index`, the job fails.
- A **non-blocking** job HEADs/GETs each source URL. 4xx/5xx is a warning so link rot does not block merges; still fix broken links before asking for `verified: true`.

`verified: true` in the index means a maintainer **test-ingested** the pack (chunks came back from the live sources). New community packs start unverified.

## Rules

- **Links and metadata only.** No lecture notes, slide text, problem solutions, or captions in the JSON.
- **Openly available courses.** If the site requires login (Canvas, Gradescope, Piazza, CAEN leccap), do not list those URLs. Use `connect_yourself` so the importer attaches them with their own credentials.
- Honor `robots.txt`. The crawler will skip disallowed paths at ingest time.
- Prefer a stable term snapshot (for example `mit-6.006-s20`) so the pack does not rot when the live term site is replaced.
- Takedown: if a rights holder asks us to remove a pack, open an issue or PR deleting `packs/<id>.json` and regenerating the index. We will merge that promptly.

## Schema

See [`packs/schema/pack.schema.json`](packs/schema/pack.schema.json). Source kinds: `website`, `pdf`, `youtube`, `transcript`. Optional `connect_yourself` kinds: `canvas`, `lecture_capture`, `local_files`.
