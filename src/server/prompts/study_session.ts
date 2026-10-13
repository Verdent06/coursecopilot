import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export function registerStudySession(server: McpServer): void {
  server.registerPrompt(
    "study_session",
    {
      title: "Study session",
      description: "Check weak spots, run a quick quiz, then record it.",
      argsSchema: z.object({
        course_id: z.string().describe("Course slug"),
        minutes: z.string().optional().describe("Session length in minutes (default 30)"),
      }),
    },
    ({ course_id, minutes }) => {
      const mins = minutes?.trim() || "30";
      return {
        description: `${mins}-minute study session for ${course_id}`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Run a ${mins}-minute study session for ${course_id}. ` +
                "1) Call get_weak_spots. 2) Call generate_quiz_context with focus 'weak'. " +
                "3) Quiz me from those chunks with citations. 4) Call record_quiz_attempt.",
            },
          },
        ],
      };
    },
  );
}
