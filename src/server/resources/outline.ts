import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { CourseRepo } from "../../db/repo.js";
import type { LearnService } from "../../learn/service.js";

export const OUTLINE_URI_TEMPLATE = "coursecopilot://course/{id}/outline";

export function registerOutlineResource(
  server: McpServer,
  repo: CourseRepo,
  learn: LearnService,
): void {
  server.registerResource(
    "course-outline",
    new ResourceTemplate(OUTLINE_URI_TEMPLATE, {
      list: async () => ({
        resources: repo.listCourses().map((c) => ({
          uri: `coursecopilot://course/${c.course_id}/outline`,
          name: `${c.course_id} outline`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Course outline",
      description: "Documents, lectures, and topics for a course.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = String(variables.id ?? "");
      const outline = await learn.getOutline(id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(outline, null, 2),
          },
        ],
      };
    },
  );
}
