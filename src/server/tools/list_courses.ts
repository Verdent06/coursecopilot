import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { CourseRepo } from "../../db/repo.js";
import { ok } from "../tool-result.js";

/**
 * List local courses with source/chunk counts and exam dates.
 * Structured output is wrapped as `{ courses }` because MCP structuredContent
 * is an object; the spec table's array is the `courses` field.
 */
export const listCoursesInputSchema = z.object({});

const examSchema = z.object({
  name: z.string(),
  date: z.string(),
  topics: z.array(z.string()),
  weight: z.number().nullable(),
});

export const listCoursesOutputSchema = z.object({
  courses: z.array(
    z.object({
      course_id: z.string(),
      title: z.string(),
      term: z.string().nullable(),
      source_count: z.number(),
      chunk_count: z.number(),
      exams: z.array(examSchema),
    }),
  ),
});

export function registerListCourses(server: McpServer, repo: CourseRepo): void {
  server.registerTool(
    "list_courses",
    {
      title: "List courses",
      description: "List all courses stored locally, with source/chunk counts and exams.",
      inputSchema: listCoursesInputSchema,
      outputSchema: listCoursesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const courses = repo.listCourses();
      const text =
        courses.length === 0
          ? "No courses yet. Call add_course to create one."
          : courses
              .map(
                (c) =>
                  `${c.course_id}: ${c.title}${c.term ? ` (${c.term})` : ""} — ${c.source_count} sources, ${c.chunk_count} chunks, ${c.exams.length} exams`,
              )
              .join("\n");
      return ok({ courses }, text);
    },
  );
}
