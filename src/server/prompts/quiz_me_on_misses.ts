import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { LearnService } from "../../learn/service.js";

/**
 * Demo flow: weak spots then grounded quiz context. Citations required.
 */
export function registerQuizMeOnMisses(server: McpServer, learn: LearnService): void {
  server.registerPrompt(
    "quiz_me_on_misses",
    {
      title: "Quiz me on my misses",
      description:
        "Quiz the student on their weakest topics using only course chunks, then record results.",
      argsSchema: z.object({
        course_id: z.string().describe("Course slug, e.g. eecs376-f26"),
      }),
    },
    async ({ course_id }) => {
      let body: string;
      try {
        const spots = await learn.getWeakSpots(course_id, 5);
        const quiz = await learn.generateQuizContext({
          course_id,
          focus: "weak",
          n: 5,
        });
        body = [
          `Quiz me on what I missed in course ${course_id}.`,
          "",
          "Weak spots (get_weak_spots):",
          JSON.stringify(spots, null, 2),
          "",
          "Grounded quiz context (generate_quiz_context focus=weak):",
          JSON.stringify(quiz, null, 2),
          "",
          quiz.instructions,
          "",
          "Rules: write questions ONLY from the provided chunks. Cite each question with chunk_id and citation.label as a Markdown link. After the quiz, call record_quiz_attempt with every item.",
        ].join("\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        body = [
          `Quiz me on what I missed in course ${course_id}.`,
          `Could not load weak spots yet: ${message}`,
          "Call get_weak_spots, then generate_quiz_context with focus 'weak'. Write questions only from those chunks and cite them. When the quiz ends, call record_quiz_attempt.",
        ].join("\n");
      }
      return {
        description: `Quiz on weak spots for ${course_id}`,
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: body },
          },
        ],
      };
    },
  );
}
