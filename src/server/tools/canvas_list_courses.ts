import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { CanvasApiError } from "../../canvas/errors.js";
import { type CanvasRuntime, listLiveCourses } from "../../canvas/tools.js";
import type { CourseRepo } from "../../db/repo.js";
import { failData, ok } from "../tool-result.js";

/**
 * List the student's Canvas courses (live API). Read-only.
 */
export const canvasListCoursesInputSchema = z.object({
  include_past: z.boolean().optional().describe("Include completed enrollments (default false)"),
});

export const canvasListCoursesOutputSchema = z.object({
  courses: z
    .array(
      z.object({
        canvas_course_id: z.string(),
        name: z.string(),
        course_code: z.string(),
        term: z.string().nullable(),
        linked_course_id: z.string().nullable(),
      }),
    )
    .optional(),
  error: z.enum(["canvas_not_configured", "token_rejected", "tokens_blocked"]).optional(),
  fallback: z.string().optional(),
});

export function registerCanvasListCourses(
  server: McpServer,
  repo: CourseRepo,
  runtime: CanvasRuntime,
): void {
  server.registerTool(
    "canvas_list_courses",
    {
      title: "Canvas: list courses",
      description:
        "List active Canvas courses for the configured personal access token. Read-only. Returns a graceful error if the token is missing, rejected, or blocked by the school.",
      inputSchema: canvasListCoursesInputSchema,
      outputSchema: canvasListCoursesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ include_past }) => {
      try {
        const courses = await listLiveCourses(runtime, repo, include_past ?? false);
        const text =
          courses.length === 0
            ? "No active Canvas courses."
            : courses.map((c) => `${c.course_code}: ${c.name} (${c.canvas_course_id})`).join("\n");
        return ok({ courses }, text);
      } catch (err) {
        if (err instanceof CanvasApiError) {
          return failData(err.payload(), err.fallback);
        }
        throw err;
      }
    },
  );
}
