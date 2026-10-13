import { McpServer } from "@modelcontextprotocol/server";
import { type OpenedDatabase, openDatabase } from "../db/migrate.js";
import { CourseRepo } from "../db/repo.js";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import { createDefaultEmbedder, type Embedder } from "../ingest/embed.js";
import { IngestQueue } from "../ingest/queue.js";
import type { YoutubeClient } from "../ingest/youtube/client.js";
import { LearnService } from "../learn/service.js";
import { PackService } from "../packs/service.js";
import { applyInstalledPackTopics } from "../packs/topics.js";
import { HybridSearch } from "../retrieve/hybrid.js";
import { getHomeDir } from "../util/paths.js";
import { SERVER_NAME, VERSION } from "../version.js";
import { registerAddMyCourse } from "./prompts/add_my_course.js";
import { registerExamPrep } from "./prompts/exam_prep.js";
import { registerExplainWithSources } from "./prompts/explain_with_sources.js";
import { registerQuizMe } from "./prompts/quiz_me.js";
import { registerQuizMeOnMisses } from "./prompts/quiz_me_on_misses.js";
import { registerStudySession } from "./prompts/study_session.js";
import { registerCoursesResource } from "./resources/courses.js";
import { registerDocumentResource } from "./resources/document.js";
import { registerMasteryResource } from "./resources/mastery.js";
import { registerOutlineResource } from "./resources/outline.js";
import { registerAddCourse } from "./tools/add_course.js";
import { registerAddPack } from "./tools/add_pack.js";
import { registerAddSource } from "./tools/add_source.js";
import { registerExportPack } from "./tools/export_pack.js";
import { registerFetch } from "./tools/fetch.js";
import { registerGenerateQuizContext } from "./tools/generate_quiz_context.js";
import { registerGetChunk } from "./tools/get_chunk.js";
import { registerGetCourseOutline } from "./tools/get_course_outline.js";
import { registerGetDocument } from "./tools/get_document.js";
import { registerGetIngestStatus } from "./tools/get_ingest_status.js";
import { registerGetStudyPlan } from "./tools/get_study_plan.js";
import { registerGetWeakSpots } from "./tools/get_weak_spots.js";
import { registerListCourses } from "./tools/list_courses.js";
import { registerListPacks } from "./tools/list_packs.js";
import { registerListSources } from "./tools/list_sources.js";
import { registerPing } from "./tools/ping.js";
import { registerRecordQuizAttempt } from "./tools/record_quiz_attempt.js";
import { registerRemoveSource } from "./tools/remove_source.js";
import { registerSearch } from "./tools/search.js";
import { registerSearchCourse } from "./tools/search_course.js";
import { registerSetExam } from "./tools/set_exam.js";
import { registerSetTopics } from "./tools/set_topics.js";
import { registerSyncCourse } from "./tools/sync_course.js";

export type AppContext = {
  opened: OpenedDatabase;
  repo: CourseRepo;
  queue: IngestQueue;
  search: HybridSearch;
  learn: LearnService;
  packs: PackService;
  allowLocalPaths: boolean;
  allowPrivateNetwork: boolean;
};

export type CreateServerOptions = {
  dbPath?: string;
  opened?: OpenedDatabase;
  /** Local file/folder sources. False in remote mode unless --allow-path (M9). */
  allowLocalPaths?: boolean;
  /** Injected embedder (tests). Default is local Transformers.js MiniLM. */
  embedder?: Embedder | null;
  /** Injected clock (tests). */
  now?: () => Date;
  /** Reuse a long-lived context (HTTP: one ctx, fresh McpServer per request). */
  ctx?: AppContext;
  /** Allow crawling loopback/RFC1918. False in remote mode (SSRF guard). */
  allowPrivateNetwork?: boolean;
  crawlDelayMs?: number;
  youtube?: YoutubeClient;
  fetchFn?: FetchLike;
  registryUrl?: string;
  homeDir?: string;
};

export function createAppContext(options: CreateServerOptions = {}): AppContext {
  const opened = options.opened ?? openDatabase({ path: options.dbPath });
  const repo = new CourseRepo(opened.db);
  const embedder = options.embedder === undefined ? createDefaultEmbedder() : options.embedder;
  const allowLocalPaths = options.allowLocalPaths ?? true;
  const allowPrivateNetwork = options.allowPrivateNetwork ?? true;
  const homeDir = options.homeDir ?? getHomeDir();
  const queue = new IngestQueue({
    repo,
    allowLocalPaths,
    embedder,
    allowPrivateNetwork,
    crawlDelayMs: options.crawlDelayMs,
    fetchFn: options.fetchFn,
    youtube: options.youtube,
    onSourceDone: async (_sourceId, courseId) => {
      applyInstalledPackTopics(repo, courseId);
    },
  });
  const search = new HybridSearch(repo, embedder, opened.vecEnabled);
  const learn = new LearnService(repo, search, embedder, options.now);
  const packs = new PackService({
    repo,
    queue,
    allowLocalPaths,
    allowPrivateNetwork,
    registryUrl: options.registryUrl,
    fetchFn: options.fetchFn,
    homeDir,
  });
  return { opened, repo, queue, search, learn, packs, allowLocalPaths, allowPrivateNetwork };
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const ctx = options.ctx ?? createAppContext(options);
  const { repo, queue, search, learn, packs, allowLocalPaths, allowPrivateNetwork } = ctx;

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
  registerAddSource(server, repo, queue, { allowLocalPaths, allowPrivateNetwork });
  registerGetIngestStatus(server, repo);
  registerListSources(server, repo);
  registerRemoveSource(server, repo);
  registerSyncCourse(server, repo, queue);
  registerSearchCourse(server, search);
  registerGetChunk(server, search);
  registerGetDocument(server, search);
  registerSearch(server, search);
  registerFetch(server, search);
  registerGetCourseOutline(server, learn);
  registerSetTopics(server, learn);
  registerGenerateQuizContext(server, learn);
  registerRecordQuizAttempt(server, learn);
  registerGetWeakSpots(server, learn);
  registerGetStudyPlan(server, learn);
  registerAddPack(server, packs);
  registerExportPack(server, packs);
  registerListPacks(server, packs);
  registerQuizMeOnMisses(server, learn);
  registerQuizMe(server);
  registerStudySession(server);
  registerExamPrep(server);
  registerExplainWithSources(server);
  registerAddMyCourse(server);
  registerCoursesResource(server, repo);
  registerDocumentResource(server, repo, search);
  registerOutlineResource(server, repo, learn);
  registerMasteryResource(server, repo, learn);

  return server;
}
