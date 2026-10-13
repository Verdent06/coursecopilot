import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import { DEFAULT_WEAK_LIMIT } from "../../learn/config.js";
import type { LearnService } from "../../learn/service.js";
import { citationSchema } from "../citation-schema.js";
import { fail, ok } from "../tool-result.js";

/**
 * Topics ranked by weakness (1−mastery + uncertainty + never-attempted, × exam weight).
 */
export const getWeakSpotsInputSchema = z.object({
  course_id: z.string().optional().describe("Course slug. Optional when only one course exists."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(`How many topics to return (default ${DEFAULT_WEAK_LIMIT})`),
});

export const getWeakSpotsOutputSchema = z.object({
  spots: z.array(
    z.object({
      topic: z.string(),
      mastery: z.number(),
      uncertainty: z.number(),
      n_attempts: z.number(),
      last_seen_days: z.number().nullable(),
      suggested_chunks: z.array(citationSchema),
    }),
  ),
});

export function registerGetWeakSpots(server: McpServer, learn: LearnService): void {
  server.registerTool(
    "get_weak_spots",
    {
      title: "Get weak spots",
      description:
        "Return the weakest topics for a course, with mastery, uncertainty, and two suggested cited chunks each. Use this before generate_quiz_context(focus:'weak').",
      inputSchema: getWeakSpotsInputSchema,
      outputSchema: getWeakSpotsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ course_id, limit }) => {
      try {
        const result = await learn.getWeakSpots(course_id, limit ?? DEFAULT_WEAK_LIMIT);
        const text =
          result.spots.length === 0
            ? "No topics yet."
            : result.spots
                .map(
                  (s, i) =>
                    `${i + 1}. ${s.topic} — mastery ${s.mastery.toFixed(2)} (${s.n_attempts} attempts)`,
                )
                .join("\n");
        return ok(result, text);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
