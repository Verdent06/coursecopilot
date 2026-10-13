import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CanvasApiError } from "../../canvas/errors.js";
import { type CanvasRuntime, listLiveAnnouncements } from "../../canvas/tools.js";
import { failData, ok } from "../tool-result.js";

/**
 * Live Canvas announcements (recent). Across all active courses when no id.
 */
export const canvasListAnnouncementsInputSchema = z.object({
  canvas_course_id: z
    .string()
    .optional()
    .describe("Limit to one Canvas course; default all active"),
  since_days: z.number().int().min(1).max(365).optional().describe("Lookback in days (default 14)"),
});

export const canvasListAnnouncementsOutputSchema = z.object({
  announcements: z
    .array(
      z.object({
        title: z.string(),
        posted_at: z.string().nullable(),
        message_markdown: z.string(),
        html_url: z.string(),
        course: z.string().optional(),
      }),
    )
    .optional(),
  error: z.enum(["canvas_not_configured", "token_rejected", "tokens_blocked"]).optional(),
  fallback: z.string().optional(),
});

export function registerCanvasListAnnouncements(server: McpServer, runtime: CanvasRuntime): void {
  server.registerTool(
    "canvas_list_announcements",
    {
      title: "Canvas: list announcements",
      description:
        "List recent Canvas announcements (live, short-cached). Omit canvas_course_id to cover every active course.",
      inputSchema: canvasListAnnouncementsInputSchema,
      outputSchema: canvasListAnnouncementsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ canvas_course_id, since_days }) => {
      try {
        const announcements = await listLiveAnnouncements(runtime, {
          canvasCourseId: canvas_course_id,
          sinceDays: since_days,
        });
        const text =
          announcements.length === 0
            ? "No recent announcements."
            : announcements
                .map(
                  (a) =>
                    `${a.course ? `${a.course}: ` : ""}${a.title} (${a.posted_at ?? "undated"})`,
                )
                .join("\n");
        return ok({ announcements }, text);
      } catch (err) {
        if (err instanceof CanvasApiError) {
          return failData(err.payload(), err.fallback);
        }
        throw err;
      }
    },
  );
}
