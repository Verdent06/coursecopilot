import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export function registerExamPrep(server: McpServer): void {
  server.registerPrompt(
    "exam_prep",
    {
      title: "Exam prep",
      description: "Turn get_study_plan into a checklist for an upcoming exam.",
      argsSchema: z.object({
        course_id: z.string().describe("Course slug"),
        exam_name: z.string().describe("Exam name as stored by set_exam"),
      }),
    },
    ({ course_id, exam_name }) => ({
      description: `Exam prep checklist for ${exam_name}`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Call get_study_plan for course ${course_id} and exam "${exam_name}". ` +
              "Turn the returned days into a checklist. Keep the citations. Do not invent extra sessions.",
          },
        },
      ],
    }),
  );
}
