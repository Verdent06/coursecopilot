import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import type { LearnService } from "../../learn/service.js";
import { fail, ok } from "../tool-result.js";

/**
 * Let the host label topics and optionally bind them to chunks or keywords.
 */
export const setTopicsInputSchema = z.object({
  course_id: z.string().describe("Course slug"),
  topics: z
    .array(
      z.object({
        name: z.string().min(1).describe("Topic name, e.g. Pumping lemma"),
        chunk_ids: z
          .array(z.number().int())
          .optional()
          .describe("Chunks that belong to this topic"),
        keywords: z
          .array(z.string())
          .optional()
          .describe("If set, also bind chunks whose text or heading contains these keywords"),
      }),
    )
    .min(1),
});

export const setTopicsOutputSchema = z.object({
  topic_ids: z.array(z.string()),
});

export function registerSetTopics(server: McpServer, learn: LearnService): void {
  server.registerTool(
    "set_topics",
    {
      title: "Set topics",
      description:
        "Create or update topic labels for a course. Optionally bind chunk_ids or keywords. Origin is recorded as host.",
      inputSchema: setTopicsInputSchema,
      outputSchema: setTopicsOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ course_id, topics }) => {
      try {
        const result = await learn.setTopics({ course_id, topics });
        return ok(result, `Saved ${result.topic_ids.length} topic(s) for ${course_id}`);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
