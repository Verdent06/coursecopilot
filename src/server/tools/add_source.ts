import { statSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type CourseRepo, RepoError, type SourceKind } from "../../db/repo.js";
import type { IngestQueue } from "../../ingest/queue.js";
import { parseYoutubeUrl } from "../../ingest/youtube/parse.js";
import { assertExists, resolveLocalPath } from "../../util/files.js";
import { newId } from "../../util/ids.js";
import { fail, ok } from "../tool-result.js";

const KIND_MILESTONE: Record<string, string> = {
  website: "website ingestion is not implemented yet (milestone M4)",
  canvas: "Canvas ingestion is not implemented yet (milestone M6)",
};

/**
 * Enqueue a source for ingestion. File, folder, youtube, and transcript kinds
 * are implemented. Returns a job_id immediately so the host can poll get_ingest_status.
 */
export const addSourceInputSchema = z.object({
  course_id: z.string().describe("Course slug returned by add_course"),
  kind: z
    .enum(["website", "file", "folder", "youtube", "transcript", "canvas"])
    .describe("Source type. Supports file, folder, youtube, and transcript."),
  uri: z
    .string()
    .describe(
      "YouTube watch/playlist URL, transcript .vtt/.srt path or URL, canvas://course/<id>, or an absolute filesystem path / file:// URI for file and folder",
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
    })
    .optional(),
});

export const addSourceOutputSchema = z.object({
  source_id: z.string(),
  job_id: z.string(),
  status: z.literal("queued"),
});

export function registerAddSource(server: McpServer, repo: CourseRepo, queue: IngestQueue): void {
  server.registerTool(
    "add_source",
    {
      title: "Add source",
      description:
        "Enqueue a course source for ingestion. File/folder index local PDF, PPTX, Markdown, and TXT. youtube fetches captions (timestamps + youtu.be deep links). transcript indexes a local or remote VTT/SRT. Returns a job_id; poll get_ingest_status.",
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
        const pending = KIND_MILESTONE[kind];
        if (pending) {
          return fail(pending);
        }
        if (kind === "file" || kind === "folder") {
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
        if (kind === "transcript") {
          if (!/^https?:\/\//i.test(uri)) {
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
        repo.requireCourse(course_id);
        const source = repo.insertSource({
          id: newId(),
          course_id,
          kind: kind as SourceKind,
          uri,
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
