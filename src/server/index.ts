import { McpServer } from "@modelcontextprotocol/server";
import { type OpenedDatabase, openDatabase } from "../db/migrate.js";
import { CourseRepo } from "../db/repo.js";
import { createDefaultEmbedder, type Embedder } from "../ingest/embed.js";
import { IngestQueue } from "../ingest/queue.js";
import { HybridSearch } from "../retrieve/hybrid.js";
import { SERVER_NAME, VERSION } from "../version.js";
import { registerCoursesResource } from "./resources/courses.js";
import { registerDocumentResource } from "./resources/document.js";
import { registerAddCourse } from "./tools/add_course.js";
import { registerAddSource } from "./tools/add_source.js";
import { registerGetChunk } from "./tools/get_chunk.js";
import { registerGetDocument } from "./tools/get_document.js";
import { registerGetIngestStatus } from "./tools/get_ingest_status.js";
import { registerListCourses } from "./tools/list_courses.js";
import { registerListSources } from "./tools/list_sources.js";
import { registerPing } from "./tools/ping.js";
import { registerRemoveSource } from "./tools/remove_source.js";
import { registerSearchCourse } from "./tools/search_course.js";
import { registerSetExam } from "./tools/set_exam.js";

export type CreateServerOptions = {
  dbPath?: string;
  opened?: OpenedDatabase;
  /** Local file/folder sources. False in remote mode unless --allow-path (M9). */
  allowLocalPaths?: boolean;
  /** Injected embedder (tests). Default is local Transformers.js MiniLM. */
  embedder?: Embedder | null;
};

export function createServer(options: CreateServerOptions = {}): McpServer {
  const opened = options.opened ?? openDatabase({ path: options.dbPath });
  const repo = new CourseRepo(opened.db);
  const embedder = options.embedder === undefined ? createDefaultEmbedder() : options.embedder;
  const queue = new IngestQueue({
    repo,
    allowLocalPaths: options.allowLocalPaths ?? true,
    embedder,
  });
  const search = new HybridSearch(repo, embedder, opened.vecEnabled);

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
  registerAddSource(server, repo, queue);
  registerGetIngestStatus(server, repo);
  registerListSources(server, repo);
  registerRemoveSource(server, repo);
  registerSearchCourse(server, search);
  registerGetChunk(server, search);
  registerGetDocument(server, search);
  registerCoursesResource(server, repo);
  registerDocumentResource(server, repo, search);

  return server;
}
