import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type CourseRepo, RepoError } from "../../db/repo.js";
import type { IngestQueue } from "../../ingest/queue.js";
import { parseYoutubeUrl } from "../../ingest/youtube/parse.js";
import { newId } from "../../util/ids.js";
import { assertPublicUrl } from "../../util/ssrf.js";
import { fail, ok } from "../tool-result.js";

/**
 * Add a YouTube video or playlist (captions only) as a course source.
 */
export const addYoutubeInputSchema = z.object({
  url: z.string().describe("YouTube watch, youtu.be, shorts, or playlist URL"),
  course_id: z
    .string()
    .optional()
    .describe("Existing course slug. Created from the video id if omitted."),
  title: z.string().optional().describe("Course title when creating a new course"),
});

export const addYoutubeOutputSchema = z.object({
  course_id: z.string(),
  source_id: z.string(),
  job_id: z.string(),
  status: z.literal("queued"),
});

export function registerAddYoutube(
  server: McpServer,
  repo: CourseRepo,
  queue: IngestQueue,
  options: { allowPrivateNetwork?: boolean } = {},
): void {
  const allowPrivateNetwork = options.allowPrivateNetwork ?? true;
  server.registerTool(
    "add_youtube",
    {
      title: "Add YouTube",
      description:
        "Index YouTube captions (timestamps + youtu.be deep links) for a video or playlist. Creates a course if needed. Poll get_ingest_status.",
      inputSchema: addYoutubeInputSchema,
      outputSchema: addYoutubeOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, course_id, title }) => {
      try {
        const parsed = parseYoutubeUrl(url);
        if (!parsed) {
          throw new RepoError(
            `Not a YouTube video or playlist URL: "${url}". Use watch, youtu.be, shorts, embed, or playlist?list=...`,
          );
        }
        if (/^https?:\/\//i.test(url) && !allowPrivateNetwork) {
          assertPublicUrl(url);
        }
        let id = course_id?.trim();
        if (id) {
          repo.requireCourse(id);
        } else {
          const created = repo.addCourse({
            title:
              title?.trim() ||
              `YouTube ${parsed.type === "video" ? parsed.videoId : parsed.playlistId}`,
          });
          id = created.course_id;
        }
        const source = repo.insertSource({
          id: newId(),
          course_id: id,
          kind: "youtube",
          uri: url,
          status: "queued",
        });
        const jobId = queue.submit(source.id);
        return ok(
          { course_id: id, source_id: source.id, job_id: jobId, status: "queued" as const },
          `Queued YouTube ${url} as course ${id} (job ${jobId})`,
        );
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
