import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export function registerGetStartedPrompt(server: McpServer): void {
  server.registerPrompt(
    "get_started",
    {
      title: "Get started",
      description:
        "Walk a new student through CourseCopilot in chat: packs, Canvas, website, YouTube, or file upload. No terminal.",
      argsSchema: z.object({
        goal: z
          .string()
          .optional()
          .describe("Optional: what they want (a course name, Canvas, exam prep, …)"),
      }),
    },
    ({ goal }) => {
      const extra = goal?.trim() ? ` Their goal: ${goal.trim()}\n` : "";
      return {
        description: "Onboard a new CourseCopilot user in chat",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                "Help me set up CourseCopilot. I should never need a terminal.\n" +
                extra +
                "1. Call get_started.\n" +
                "2. If they have no courses, offer browse_packs (suggest harvard-cs50x), add_course_website, add_youtube, connect_canvas (Calendar feed first — never ask for a token or ICS URL in chat), or upload_files.\n" +
                "3. UMich lecture recordings: connect_leccap (browser extension, no cookie copy), then add_source kind leccap.\n" +
                "4. After ingest, call get_course_outline and ask for exam dates before set_exam.\n" +
                "5. Then offer quiz_me_on_misses or search_course with citations.",
            },
          },
        ],
      };
    },
  );
}
