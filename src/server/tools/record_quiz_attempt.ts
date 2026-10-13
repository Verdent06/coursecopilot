import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import type { LearnService } from "../../learn/service.js";
import { fail, ok } from "../tool-result.js";

/**
 * Store graded quiz items and update Beta topic mastery. Write tool.
 */
export const recordQuizAttemptInputSchema = z.object({
  course_id: z.string().optional().describe("Course slug. Optional when only one course exists."),
  mode: z
    .enum(["quiz", "exam_sim", "quick_check"])
    .optional()
    .describe("Attempt mode (default quiz)"),
  items: z
    .array(
      z.object({
        topic: z.string().min(1),
        question: z.string(),
        user_answer: z.string(),
        correct: z.union([z.boolean(), z.literal(0), z.literal(1)]),
        partial_credit: z.number().min(0).max(1).optional(),
        difficulty: z.number().int().min(1).max(3).optional(),
        confidence: z.number().int().min(1).max(3).optional(),
        cited_chunk_ids: z.array(z.number().int()).optional(),
      }),
    )
    .min(1),
});

export const recordQuizAttemptOutputSchema = z.object({
  attempt_id: z.string(),
  mastery_delta: z.array(
    z.object({
      topic: z.string(),
      before: z.number(),
      after: z.number(),
    }),
  ),
});

export function registerRecordQuizAttempt(server: McpServer, learn: LearnService): void {
  server.registerTool(
    "record_quiz_attempt",
    {
      title: "Record quiz attempt",
      description:
        "Store graded quiz results and update per-topic mastery (Beta posterior with forgetting). Call this after the host grades the user's answers. May be unavailable on ChatGPT Pro (write tool).",
      inputSchema: recordQuizAttemptInputSchema,
      outputSchema: recordQuizAttemptOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ course_id, mode, items }) => {
      try {
        const result = learn.recordQuizAttempt({ course_id, mode, items });
        const delta = result.mastery_delta
          .map((d) => `${d.topic}: ${d.before.toFixed(2)} → ${d.after.toFixed(2)}`)
          .join("; ");
        return ok(result, `Recorded ${result.attempt_id}. Mastery: ${delta}`);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
