import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export function registerAddMyCourse(server: McpServer): void {
  server.registerPrompt(
    "add_my_course",
    {
      title: "Add my course",
      description:
        "Guided setup: check list_packs first, then add-pack or add a website URL, then ask for exam dates.",
      argsSchema: z.object({
        url_or_pack: z.string().describe("Pack id, pack URL/path, or a public course website URL"),
      }),
    },
    ({ url_or_pack }) => {
      const target = url_or_pack.trim();
      return {
        description: `Set up course from ${target}`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Help me add this course: ${target}\n` +
                "1. Call list_packs with query matching this string. If a pack id matches, call add_pack and poll get_ingest_status.\n" +
                "2. If it looks like a pack URL or local manifest path, call add_pack directly.\n" +
                "3. Otherwise create a course with add_course, then add_source kind website (or youtube/transcript as appropriate).\n" +
                "4. After ingest, call get_course_outline and ask me for exam dates, then set_exam (never invent dates).",
            },
          },
        ],
      };
    },
  );
}
