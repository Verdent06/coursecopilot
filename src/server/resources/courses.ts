import type { McpServer } from "@modelcontextprotocol/server";
import type { CourseRepo } from "../../db/repo.js";

export const COURSES_URI = "coursecopilot://courses";

export function registerCoursesResource(server: McpServer, repo: CourseRepo): void {
  server.registerResource(
    "courses",
    COURSES_URI,
    {
      title: "Courses",
      description: "All locally stored courses, as JSON.",
      mimeType: "application/json",
    },
    async (uri) => {
      const courses = repo.listCourses();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ courses }, null, 2),
          },
        ],
      };
    },
  );
}
