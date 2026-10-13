import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { type CourseRepo, RepoError } from "../../db/repo.js";
import { fail, ok } from "../tool-result.js";

/**
 * Record or replace an exam on a course (name, ISO date, optional topics/weight).
 */
export const setExamInputSchema = z.object({
  course_id: z.string().describe("Course slug returned by add_course"),
  name: z.string().min(1).describe('Exam name, e.g. "Midterm"'),
  date: z.string().describe("ISO date YYYY-MM-DD"),
  topics: z.array(z.string()).optional().describe("Topic names this exam covers"),
  weight: z.number().min(0).max(1).optional().describe("Relative weight 0..1"),
});

export const setExamOutputSchema = z.object({
  exams: z.array(
    z.object({
      name: z.string(),
      date: z.string(),
      topics: z.array(z.string()),
      weight: z.number().nullable(),
    }),
  ),
});

export function registerSetExam(server: McpServer, repo: CourseRepo): void {
  server.registerTool(
    "set_exam",
    {
      title: "Set exam",
      description: "Add or replace an exam date on a course. Same name updates the existing exam.",
      inputSchema: setExamInputSchema,
      outputSchema: setExamOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ course_id, name, date, topics, weight }) => {
      try {
        const result = repo.setExam({ course_id, name, date, topics, weight });
        return ok(
          result,
          `Saved ${result.exams.length} exam(s) for ${course_id}: ${result.exams
            .map((e) => `${e.name} on ${e.date}`)
            .join("; ")}`,
        );
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
