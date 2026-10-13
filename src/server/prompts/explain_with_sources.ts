import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export function registerExplainWithSources(server: McpServer): void {
  server.registerPrompt(
    "explain_with_sources",
    {
      title: "Explain with sources",
      description: "Answer only from search_course results and cite every claim.",
      argsSchema: z.object({
        course_id: z.string().describe("Course slug"),
        question: z.string().describe("The student's question"),
      }),
    },
    ({ course_id, question }) => ({
      description: `Grounded explanation for ${course_id}`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Answer this using only ${course_id} materials:\n\n${question}\n\n` +
              "Call search_course first. Cite every claim with citation.label as a Markdown link to citation.url. " +
              'If retrieval is empty, say "not in course materials."',
          },
        },
      ],
    }),
  );
}
