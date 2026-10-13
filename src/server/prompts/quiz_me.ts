import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export function registerQuizMe(server: McpServer): void {
  server.registerPrompt(
    "quiz_me",
    {
      title: "Quiz me",
      description: "Generate a short grounded quiz for a course, optionally on one topic.",
      argsSchema: z.object({
        course_id: z.string().describe("Course slug"),
        topic: z.string().optional().describe("Optional topic name"),
        n: z.string().optional().describe("Number of questions (default 5)"),
      }),
    },
    ({ course_id, topic, n }) => {
      const count = n?.trim() || "5";
      const topicLine = topic?.trim()
        ? `Restrict to topic "${topic.trim()}".`
        : "Cover a mix of topics (focus all, or weak if the student has misses).";
      return {
        description: `Quiz on ${course_id}`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Quiz me on ${course_id} (${count} questions). ${topicLine}\n` +
                "Call generate_quiz_context, write questions ONLY from the returned chunks, cite chunk_ids, ask one at a time, grade each answer, and call record_quiz_attempt when done.",
            },
          },
        ],
      };
    },
  );
}
