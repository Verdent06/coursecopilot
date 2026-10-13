import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type CourseRepo, RepoError } from "../../db/repo.js";
import { fail, ok } from "../tool-result.js";

/**
 * Poll ingestion jobs. Structured output is `{ jobs }` because MCP
 * structuredContent is an object; the spec table's array is the `jobs` field.
 */
export const getIngestStatusInputSchema = z.object({
  job_id: z.string().optional().describe("If set, only this job"),
  course_id: z.string().optional().describe("If set, jobs for sources of this course"),
});

const skippedSchema = z.object({
  url: z.string(),
  reason: z.string(),
});

export const getIngestStatusOutputSchema = z.object({
  jobs: z.array(
    z.object({
      job_id: z.string(),
      source_id: z.string(),
      state: z.string(),
      progress: z.number(),
      message: z.string(),
      docs: z.number(),
      chunks: z.number(),
      skipped: z.array(skippedSchema),
    }),
  ),
});

export function registerGetIngestStatus(server: McpServer, repo: CourseRepo): void {
  server.registerTool(
    "get_ingest_status",
    {
      title: "Get ingest status",
      description: "Poll ingestion job progress, document/chunk counts, and skipped URLs.",
      inputSchema: getIngestStatusInputSchema,
      outputSchema: getIngestStatusOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ job_id, course_id }) => {
      try {
        const jobs = repo.listIngestStatus({ job_id, course_id });
        const text =
          jobs.length === 0
            ? "No ingest jobs."
            : jobs
                .map(
                  (j) =>
                    `${j.job_id}: ${j.state} ${(j.progress * 100).toFixed(0)}% — ${j.message} (${j.docs} docs, ${j.chunks} chunks)`,
                )
                .join("\n");
        return ok({ jobs }, text);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
