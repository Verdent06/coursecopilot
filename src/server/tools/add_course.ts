import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type CourseRepo, RepoError } from "../../db/repo.js";
import { fail, ok } from "../tool-result.js";

/**
 * Create a local course. course_id is a slug (e.g. eecs376-f26); generated from
 * title + term when omitted.
 */
export const addCourseInputSchema = z.object({
  title: z.string().min(1).describe("Human-readable course title"),
  term: z.string().optional().describe('Term label, e.g. "F26"'),
  course_id: z
    .string()
    .optional()
    .describe("Optional slug. Generated from title and term when omitted."),
});

export const addCourseOutputSchema = z.object({
  course_id: z.string(),
});

export function registerAddCourse(server: McpServer, repo: CourseRepo): void {
  server.registerTool(
    "add_course",
    {
      title: "Add course",
      description: "Create a course. Returns the course_id slug used by later tools.",
      inputSchema: addCourseInputSchema,
      outputSchema: addCourseOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, term, course_id }) => {
      try {
        const result = repo.addCourse({ title, term, course_id });
        return ok(result, `Created course ${result.course_id}`);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
