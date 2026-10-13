import { McpServer } from "@modelcontextprotocol/server";
import { type OpenedDatabase, openDatabase } from "../db/migrate.js";
import { CourseRepo } from "../db/repo.js";
import { SERVER_NAME, VERSION } from "../version.js";
import { registerCoursesResource } from "./resources/courses.js";
import { registerAddCourse } from "./tools/add_course.js";
import { registerListCourses } from "./tools/list_courses.js";
import { registerPing } from "./tools/ping.js";
import { registerSetExam } from "./tools/set_exam.js";

export type CreateServerOptions = {
  dbPath?: string;
  opened?: OpenedDatabase;
};

export function createServer(options: CreateServerOptions = {}): McpServer {
  const opened = options.opened ?? openDatabase({ path: options.dbPath });
  const repo = new CourseRepo(opened.db);

  const server = new McpServer({
    name: SERVER_NAME,
    version: VERSION,
    title: "CourseCopilot",
    websiteUrl: "https://github.com/Verdent06/coursecopilot",
  });

  registerPing(server);
  registerAddCourse(server, repo);
  registerListCourses(server, repo);
  registerSetExam(server, repo);
  registerCoursesResource(server, repo);

  return server;
}
