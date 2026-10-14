import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type CourseRepo, RepoError } from "../../db/repo.js";
import type { IngestQueue } from "../../ingest/queue.js";
import { newId } from "../../util/ids.js";
import { assertPublicUrl } from "../../util/ssrf.js";
import { fail, ok } from "../tool-result.js";

/**
 * Add a public course website as a source (chat-friendly wrapper around add_source).
 */
export const addCourseWebsiteInputSchema = z.object({
  url: z.string().describe("Public course website URL, e.g. https://eecs376.org/"),
  course_id: z
    .string()
    .optional()
    .describe("Existing course slug. Created from the site host if omitted."),
  title: z.string().optional().describe("Course title when creating a new course"),
});

export const addCourseWebsiteOutputSchema = z.object({
  course_id: z.string(),
  source_id: z.string(),
  job_id: z.string(),
  status: z.literal("queued"),
});

export function registerAddCourseWebsite(
  server: McpServer,
  repo: CourseRepo,
  queue: IngestQueue,
  options: { allowPrivateNetwork?: boolean } = {},
): void {
  const allowPrivateNetwork = options.allowPrivateNetwork ?? true;
  server.registerTool(
    "add_course_website",
    {
      title: "Add course website",
      description:
        "Crawl a public course website (robots.txt, same-site, linked PDFs/PPTX) into a course. Creates the course if needed. Poll get_ingest_status.",
      inputSchema: addCourseWebsiteInputSchema,
      outputSchema: addCourseWebsiteOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, course_id, title }) => {
      try {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new RepoError(`Invalid website URL "${url}". Use an http(s) URL.`);
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new RepoError(`Website URI must be http(s); got ${parsed.protocol}`);
        }
        if (!allowPrivateNetwork) {
          assertPublicUrl(url);
        }
        let id = course_id?.trim();
        if (id) {
          repo.requireCourse(id);
        } else {
          const created = repo.addCourse({
            title: title?.trim() || parsed.hostname.replace(/^www\./, ""),
          });
          id = created.course_id;
        }
        const source = repo.insertSource({
          id: newId(),
          course_id: id,
          kind: "website",
          uri: url,
          status: "queued",
        });
        const jobId = queue.submit(source.id);
        return ok(
          { course_id: id, source_id: source.id, job_id: jobId, status: "queued" as const },
          `Queued website ${url} as course ${id} (job ${jobId})`,
        );
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
