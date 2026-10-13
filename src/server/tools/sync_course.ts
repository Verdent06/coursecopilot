import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type CourseRepo, RepoError } from "../../db/repo.js";
import type { IngestQueue } from "../../ingest/queue.js";
import { fail, ok } from "../tool-result.js";

/**
 * Incremental re-fetch of a course's sources (or one source). Unchanged
 * documents (matching sha256 / ETag) are not re-extracted or re-embedded.
 */
export const syncCourseInputSchema = z.object({
  course_id: z.string().describe("Course slug"),
  source_id: z.string().optional().describe("If set, only this source is re-fetched"),
});

export const syncCourseOutputSchema = z.object({
  job_ids: z.array(z.string()),
});

export function registerSyncCourse(server: McpServer, repo: CourseRepo, queue: IngestQueue): void {
  server.registerTool(
    "sync_course",
    {
      title: "Sync course",
      description:
        "Re-fetch course sources incrementally. Unchanged documents (content hash or ETag) skip re-embedding. Optional source_id limits the sync to one source.",
      inputSchema: syncCourseInputSchema,
      outputSchema: syncCourseOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ course_id, source_id }) => {
      try {
        repo.requireCourse(course_id);
        if (source_id) {
          const source = repo.getSource(source_id);
          if (!source) {
            throw new RepoError(`Unknown source_id "${source_id}"`);
          }
          if (source.course_id !== course_id) {
            throw new RepoError(
              `source_id "${source_id}" does not belong to course "${course_id}"`,
            );
          }
          const jobId = queue.submit(source.id);
          return ok({ job_ids: [jobId] }, `Queued sync job ${jobId}`);
        }
        const sources = repo.listSources(course_id);
        const jobIds: string[] = [];
        for (const source of sources) {
          if (source.kind !== "file" && source.kind !== "folder" && source.kind !== "website") {
            continue;
          }
          jobIds.push(queue.submit(source.source_id));
        }
        const text =
          jobIds.length === 0
            ? `No syncable sources on ${course_id}.`
            : `Queued ${jobIds.length} sync job(s)`;
        return ok({ job_ids: jobIds }, text);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
