import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { RepoError } from "../../db/repo.js";
import { DEFAULT_MINUTES_PER_DAY } from "../../learn/config.js";
import type { LearnService } from "../../learn/service.js";
import { citationSchema } from "../citation-schema.js";
import { fail, ok } from "../tool-result.js";

/**
 * Deterministic exam study plan: minutes ∝ weakness, review→quiz, spaced repeats, final exam_sim.
 */
export const getStudyPlanInputSchema = z.object({
  course_id: z.string().optional().describe("Course slug. Optional when only one course exists."),
  exam_name: z.string().optional().describe("Exam to plan for (default: nearest upcoming)"),
  days: z.number().int().min(1).max(60).optional().describe("Override plan length in days"),
  minutes_per_day: z
    .number()
    .int()
    .min(15)
    .max(480)
    .optional()
    .describe(`Study minutes per day (default ${DEFAULT_MINUTES_PER_DAY})`),
});

export const getStudyPlanOutputSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      sessions: z.array(
        z.object({
          topic: z.string(),
          activity: z.enum(["review", "quiz", "practice"]),
          minutes: z.number(),
          chunks: z.array(citationSchema),
        }),
      ),
    }),
  ),
  rationale: z.string(),
});

export function registerGetStudyPlan(server: McpServer, learn: LearnService): void {
  server.registerTool(
    "get_study_plan",
    {
      title: "Get study plan",
      description:
        "Return a deterministic day-by-day study plan. Topics are ranked by weakness × exam listing. The last day is a mixed exam simulation. Format this as a checklist for the student.",
      inputSchema: getStudyPlanInputSchema,
      outputSchema: getStudyPlanOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ course_id, exam_name, days, minutes_per_day }) => {
      try {
        const result = await learn.getStudyPlan({
          course_id,
          exam_name,
          days,
          minutes_per_day,
        });
        const text = `${result.rationale}\n\n${result.days
          .map(
            (d) =>
              `${d.date}: ` +
              d.sessions.map((s) => `${s.activity} ${s.topic} (${s.minutes}m)`).join(", "),
          )
          .join("\n")}`;
        return ok(result, text);
      } catch (err) {
        return fail(err instanceof RepoError ? err.message : String(err));
      }
    },
  );
}
