import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import { DEFAULT_QUIZ_N, MAX_QUIZ_N } from "../../learn/config.js";
import type { LearnService } from "../../learn/service.js";
import { citationSchema } from "../citation-schema.js";
import { fail, ok } from "../tool-result.js";

/**
 * Grounded quiz scaffold. The host AI writes questions from the returned chunks;
 * this server never calls an LLM.
 */
export const generateQuizContextInputSchema = z.object({
  course_id: z.string().optional().describe("Course slug. Optional when only one course exists."),
  topics: z.array(z.string()).optional().describe("Restrict to these topic names"),
  n: z
    .number()
    .int()
    .min(1)
    .max(MAX_QUIZ_N)
    .optional()
    .describe(`Number of questions to scaffold (default ${DEFAULT_QUIZ_N})`),
  difficulty: z.number().int().min(1).max(3).optional().describe("Target difficulty 1..3"),
  focus: z
    .enum(["weak", "all", "exam"])
    .optional()
    .describe("Pick weak spots, all topics, or an upcoming exam's topics"),
  exam_name: z.string().optional().describe("Exam to focus on when focus is exam"),
});

export const generateQuizContextOutputSchema = z.object({
  items: z.array(
    z.object({
      topic: z.string(),
      chunks: z.array(
        z.object({
          chunk_id: z.number(),
          text: z.string(),
          citation: citationSchema,
        }),
      ),
    }),
  ),
  instructions: z.string(),
  instructions_version: z.number(),
});

export function registerGenerateQuizContext(server: McpServer, learn: LearnService): void {
  server.registerTool(
    "generate_quiz_context",
    {
      title: "Generate quiz context",
      description:
        "Return source chunks grouped by topic plus question-writing instructions. Write questions from the chunks only, cite chunk_ids, then call record_quiz_attempt after grading. Read-only: Pro/ChatGPT can use this without write tools.",
      inputSchema: generateQuizContextInputSchema,
      outputSchema: generateQuizContextOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ course_id, topics, n, difficulty, focus, exam_name }) => {
      try {
        const result = await learn.generateQuizContext({
          course_id,
          topics,
          n,
          difficulty,
          focus,
          exam_name,
        });
        const itemsText = result.items
          .map((item, i) => {
            const chunks = item.chunks
              .map(
                (c) => `  - ${c.citation.label} (chunk ${c.chunk_id})\n    ${c.text.slice(0, 200)}`,
              )
              .join("\n");
            return `${i + 1}. ${item.topic}\n${chunks}`;
          })
          .join("\n\n");
        const text = `${itemsText}\n\n${result.instructions}`;
        return ok(result, text);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
