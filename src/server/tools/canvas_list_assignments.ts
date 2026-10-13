import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CanvasApiError } from "../../canvas/errors.js";
import { type CanvasRuntime, listLiveAssignments } from "../../canvas/tools.js";
import { failData, ok } from "../tool-result.js";

/**
 * Live Canvas assignments with due dates. Across all active courses when no id.
 */
export const canvasListAssignmentsInputSchema = z.object({
  canvas_course_id: z
    .string()
    .optional()
    .describe("Limit to one Canvas course; default all active"),
  upcoming_only: z.boolean().optional().describe("Only assignments due soon (default true)"),
  days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe("Upcoming window in days (default 14)"),
});

export const canvasListAssignmentsOutputSchema = z.object({
  assignments: z
    .array(
      z.object({
        name: z.string(),
        due_at: z.string().nullable(),
        due_at_local: z.string().nullable(),
        points: z.number().nullable(),
        submission_types: z.array(z.string()),
        html_url: z.string(),
        course: z.string(),
      }),
    )
    .optional(),
  error: z.enum(["canvas_not_configured", "token_rejected", "tokens_blocked"]).optional(),
  fallback: z.string().optional(),
});

export function registerCanvasListAssignments(server: McpServer, runtime: CanvasRuntime): void {
  server.registerTool(
    "canvas_list_assignments",
    {
      title: "Canvas: list assignments",
      description:
        "List assignments and due dates from Canvas (live, short-cached). Omit canvas_course_id to cover every active course. Default: upcoming in the next 14 days.",
      inputSchema: canvasListAssignmentsInputSchema,
      outputSchema: canvasListAssignmentsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ canvas_course_id, upcoming_only, days }) => {
      try {
        const assignments = await listLiveAssignments(runtime, {
          canvasCourseId: canvas_course_id,
          upcomingOnly: upcoming_only,
          days,
        });
        const text =
          assignments.length === 0
            ? "Nothing due in that window."
            : assignments
                .map(
                  (a) => `${a.course}: ${a.name} — ${a.due_at_local ?? a.due_at ?? "no due date"}`,
                )
                .join("\n");
        return ok({ assignments }, text);
      } catch (err) {
        if (err instanceof CanvasApiError) {
          return failData(err.payload(), err.fallback);
        }
        throw err;
      }
    },
  );
}
