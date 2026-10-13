import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import type { LearnService } from "../../learn/service.js";
import { fail, ok } from "../tool-result.js";

/**
 * Documents grouped by source, lectures in order, and current topics.
 */
export const getCourseOutlineInputSchema = z.object({
  course_id: z.string().optional().describe("Course slug. Optional when only one course exists."),
});

export const getCourseOutlineOutputSchema = z.object({
  course_id: z.string(),
  title: z.string(),
  sources: z.array(
    z.object({
      source_id: z.string(),
      kind: z.string(),
      uri: z.string(),
      documents: z.array(
        z.object({
          document_id: z.string(),
          title: z.string(),
          lecture_no: z.number().nullable(),
          chunk_count: z.number(),
        }),
      ),
    }),
  ),
  lectures: z.array(
    z.object({
      lecture_no: z.number(),
      title: z.string(),
      document_ids: z.array(z.string()),
    }),
  ),
  topics: z.array(
    z.object({
      topic_id: z.string(),
      name: z.string(),
      origin: z.string(),
      chunk_count: z.number(),
    }),
  ),
});

export function registerGetCourseOutline(server: McpServer, learn: LearnService): void {
  server.registerTool(
    "get_course_outline",
    {
      title: "Get course outline",
      description:
        "List documents grouped by source, lectures in order, and topics. Propose better topic names via set_topics if the heuristic list looks off.",
      inputSchema: getCourseOutlineInputSchema,
      outputSchema: getCourseOutlineOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ course_id }) => {
      try {
        const result = await learn.getOutline(course_id);
        const topicNames =
          result.topics.length === 0
            ? "no topics yet"
            : result.topics.map((t) => t.name).join(", ");
        return ok(
          result,
          `${result.title}: ${result.sources.length} source(s), ${result.lectures.length} lecture(s). Topics: ${topicNames}`,
        );
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
