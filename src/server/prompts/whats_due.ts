import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

/**
 * Group upcoming Canvas assignments + announcements, then offer a study session.
 */
export function registerWhatsDue(server: McpServer): void {
  server.registerPrompt(
    "whats_due",
    {
      title: "What's due",
      description:
        "List upcoming Canvas assignments and recent announcements, grouped by course. Offers a study session for the nearest exam.",
      argsSchema: z.object({
        days: z.string().optional().describe("Lookahead in days (default 7)"),
      }),
    },
    ({ days }) => {
      const window = days?.trim() || "7";
      return {
        description: `What's due in the next ${window} days`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `What's due in the next ${window} days?\n` +
                `1. Call canvas_list_assignments with upcoming_only=true and days=${window}. ` +
                "If it returns canvas_not_configured, token_rejected, or tokens_blocked, tell the student the fallback " +
                "(public course website, a course pack, or download files and add a folder) and stop.\n" +
                `2. Call canvas_list_announcements with since_days=${window}.\n` +
                "3. Group assignments and announcements by course. Show due dates (ISO and local) and Canvas links.\n" +
                "4. If a nearby exam exists (set_exam, or a Canvas assignment named Midterm/Exam/Final), " +
                "offer a study_session for that course. Suggested exam dates are never set automatically — ask before calling set_exam.",
            },
          },
        ],
      };
    },
  );
}
