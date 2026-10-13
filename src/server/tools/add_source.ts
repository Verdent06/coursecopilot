import { statSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadCanvasCredentials } from "../../canvas/auth.js";
import { CANVAS_ERROR, canvasErrorPayload } from "../../canvas/errors.js";
import { canvasCourseUri, parseCanvasCourseId } from "../../canvas/uri.js";
import { type CourseRepo, RepoError, type SourceKind } from "../../db/repo.js";
import { parseLeccapUrl } from "../../ingest/providers/leccap/parse.js";
import type { IngestQueue } from "../../ingest/queue.js";
import { parseYoutubeUrl } from "../../ingest/youtube/parse.js";
import { assertExists, resolveLocalPath } from "../../util/files.js";
import { newId } from "../../util/ids.js";
import { assertPublicUrl } from "../../util/ssrf.js";
import { fail, failData, ok } from "../tool-result.js";

/**
 * Enqueue a source for ingestion. Website, file, folder, youtube, transcript,
 * canvas, and leccap kinds are implemented. Returns a job_id immediately so the host can
 * poll get_ingest_status.
 */
export const addSourceInputSchema = z.object({
  course_id: z.string().describe("Course slug returned by add_course"),
  kind: z
    .enum(["website", "file", "folder", "youtube", "transcript", "canvas", "leccap"])
    .describe(
      "Source type. website, file, folder, youtube, transcript, canvas (read-only), and leccap are implemented.",
    ),
  uri: z
    .string()
    .describe(
      "Public course website URL, YouTube watch/playlist URL, transcript .vtt/.srt path or URL, leccap site/player URL, canvas://course/<id>, or an absolute filesystem path / file:// URI for file and folder",
    ),
  options: z
    .object({
      max_depth: z.number().optional().describe("Website crawl depth (M4)"),
      max_pages: z.number().optional().describe("Website page cap (M4)"),
      include_prefix: z.string().optional().describe("Website path prefix (M4)"),
      lecture_no: z.number().optional().describe("Optional lecture number stored on documents"),
      as_slides: z
        .boolean()
        .optional()
        .describe("Treat PDF pages as slides so citations use 'slide N' instead of 'p. N'"),
      ocr: z
        .boolean()
        .optional()
        .describe("OCR slide images for leccap (default true if tesseract.js is installed)"),
      whiteboard: z
        .boolean()
        .optional()
        .describe("Include whiteboard aux_source images for leccap (default: metadata only)"),
    })
    .optional(),
});

export const addSourceOutputSchema = z.object({
  source_id: z.string(),
  job_id: z.string(),
  status: z.literal("queued"),
});

export function registerAddSource(
  server: McpServer,
  repo: CourseRepo,
  queue: IngestQueue,
  options: { allowLocalPaths?: boolean; allowPrivateNetwork?: boolean } = {},
): void {
  const allowLocalPaths = options.allowLocalPaths ?? true;
  const allowPrivateNetwork = options.allowPrivateNetwork ?? true;
  server.registerTool(
    "add_source",
    {
      title: "Add source",
      description:
        "Enqueue a course source for ingestion. website crawls a public course site (robots, same-site crawl, linked PDFs/PPTX). File/folder index local PDF, PPTX, Markdown, and TXT. youtube fetches captions (timestamps + youtu.be deep links). transcript indexes a local or remote VTT/SRT. canvas (uri canvas://course/<id>) ingests pages, files, modules, assignments, and announcements with a local Canvas token. leccap indexes UMich CAEN Lecture Capture (sign in first with `coursecopilot login leccap`). Returns a job_id; poll get_ingest_status.",
      inputSchema: addSourceInputSchema,
      outputSchema: addSourceOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ course_id, kind, uri, options }) => {
      try {
        if (/^https?:\/\//i.test(uri) && !allowPrivateNetwork) {
          assertPublicUrl(uri);
        }
        if (kind === "website") {
          let parsed: URL;
          try {
            parsed = new URL(uri);
          } catch {
            throw new RepoError(`Invalid website URL "${uri}". Use an http(s) URL.`);
          }
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new RepoError(`Website URI must be http(s); got ${parsed.protocol}`);
          }
        }
        if (kind === "file" || kind === "folder") {
          if (!allowLocalPaths) {
            return fail(
              "Local file paths are disabled unless --allow-path is set (remote mode). Use a website, pack, or Canvas source instead.",
            );
          }
          const abs = resolveLocalPath(uri);
          assertExists(abs);
          const st = statSync(abs);
          if (kind === "file" && st.isDirectory()) {
            throw new RepoError(`uri is a directory; use kind "folder" for ${abs}`);
          }
          if (kind === "folder" && !st.isDirectory()) {
            throw new RepoError(`uri is a file; use kind "file" for ${abs}`);
          }
        }
        if (kind === "youtube") {
          const parsed = parseYoutubeUrl(uri);
          if (!parsed) {
            throw new RepoError(
              `Not a YouTube video or playlist URL: "${uri}". Use watch, youtu.be, shorts, embed, or playlist?list=...`,
            );
          }
        }
        let storedUri = uri;
        if (kind === "canvas") {
          const canvasId = parseCanvasCourseId(uri);
          if (!canvasId) {
            throw new RepoError(
              `Canvas URI must be canvas://course/<id> (got "${uri}"). Example: canvas://course/12345`,
            );
          }
          storedUri = canvasCourseUri(canvasId);
          if (!loadCanvasCredentials()) {
            const payload = canvasErrorPayload(CANVAS_ERROR.notConfigured);
            return failData(payload, payload.fallback);
          }
        }
        if (kind === "transcript") {
          if (!/^https?:\/\//i.test(uri)) {
            if (!allowLocalPaths) {
              return fail(
                "Local file paths are disabled unless --allow-path is set (remote mode). Use an http(s) transcript URL, website, pack, or Canvas source instead.",
              );
            }
            const abs = resolveLocalPath(uri);
            assertExists(abs);
            const st = statSync(abs);
            if (st.isDirectory()) {
              throw new RepoError(
                `uri is a directory; use a .vtt or .srt file for kind "transcript"`,
              );
            }
          }
        }
        let sourceUri = storedUri;
        if (kind === "leccap") {
          const parsed = parseLeccapUrl(uri);
          if (!parsed) {
            throw new RepoError(
              `Not a CAEN Lecture Capture URL: "${uri}". Paste a site link (https://leccap.engin.umich.edu/leccap/site/...) or a player link (.../leccap/player/r/...). Sign in first: npx coursecopilot login leccap`,
            );
          }
          sourceUri = parsed.canonical;
        }
        repo.requireCourse(course_id);
        const existing =
          kind === "leccap" ? repo.findSourceByUri(course_id, "leccap", sourceUri) : undefined;
        const source = existing
          ? existing
          : repo.insertSource({
              id: newId(),
              course_id,
              kind: kind as SourceKind,
              uri: sourceUri,
              config_json: options ? JSON.stringify(options) : null,
              status: "queued",
            });
        const jobId = queue.submit(source.id);
        return ok(
          { source_id: source.id, job_id: jobId, status: "queued" as const },
          `Queued ${kind} source ${source.id} (job ${jobId})`,
        );
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
