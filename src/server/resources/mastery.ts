import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { CourseRepo } from "../../db/repo.js";
import type { LearnService } from "../../learn/service.js";

export const MASTERY_URI_TEMPLATE = "coursecopilot://course/{id}/mastery";

export function registerMasteryResource(
  server: McpServer,
  repo: CourseRepo,
  learn: LearnService,
): void {
  server.registerResource(
    "course-mastery",
    new ResourceTemplate(MASTERY_URI_TEMPLATE, {
      list: async () => ({
        resources: repo.listCourses().map((c) => ({
          uri: `coursecopilot://course/${c.course_id}/mastery`,
          name: `${c.course_id} mastery`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Course mastery",
      description: "Per-topic mastery after forgetting decay.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = String(variables.id ?? "");
      const body = learn.listMasteryResource(id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2),
          },
        ],
      };
    },
  );
}
