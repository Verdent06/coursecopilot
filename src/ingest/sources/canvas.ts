import { basename } from "node:path";
import { loadCanvasCredentials } from "../../canvas/auth.js";
import {
  type CanvasAssignment,
  type CanvasClient,
  type CanvasFile,
  type CanvasModule,
  type CanvasPage,
  createCanvasClient,
} from "../../canvas/client.js";
import { CanvasApiError } from "../../canvas/errors.js";
import { extractCanvasHtml, withCanvasLocator } from "../../canvas/markdown.js";
import { parseCanvasCourseId } from "../../canvas/uri.js";
import type { CourseRepo } from "../../db/repo.js";
import { RepoError } from "../../db/repo.js";
import type { FetchLike } from "../crawl/fetch.js";
import { sha256 } from "../hash.js";
import { MIME_HTML, MIME_PDF, MIME_PPTX, routeFetchedKind, supportedKind } from "../mime.js";
import { persistExtracted } from "../persist.js";
import type {
  ExtractedDocument,
  IngestResult,
  Locator,
  SkipReason,
  SuggestedExam,
} from "../types.js";
import type { ProgressFn } from "./file.js";
import { suggestExams } from "./html.js";
import { extractPdf } from "./pdf.js";
import { extractPptx } from "./pptx.js";
import { extractMarkdown, extractPlainText } from "./text.js";

export type CanvasIngestContext = {
  repo: CourseRepo;
  canvas?: CanvasClient;
  fetchFn?: FetchLike;
};

const LTI_SKIP =
  "export transcript as VTT and add it as a transcript source (Panopto/Kaltura LTI is not fetchable)";

export async function ingestCanvasSource(
  ctx: CanvasIngestContext,
  sourceId: string,
  onProgress: ProgressFn = () => undefined,
): Promise<IngestResult> {
  const source = ctx.repo.getSource(sourceId);
  if (!source) {
    throw new RepoError(`Unknown source_id "${sourceId}"`);
  }
  if (source.kind !== "canvas") {
    throw new RepoError(`ingestCanvasSource cannot handle kind "${source.kind}"`);
  }

  const courseIdNum = parseCanvasCourseId(source.uri);
  if (!courseIdNum) {
    throw new RepoError(
      `Canvas URI must be canvas://course/<id> (got "${source.uri}"). Example: canvas://course/12345`,
    );
  }

  const client = ctx.canvas ?? openClient(ctx.fetchFn);
  await client.getSelf();

  const course = await client.getCourse(courseIdNum);
  ctx.repo.updateSource(sourceId, { title: course.name });

  const skipped: SkipReason[] = [];
  const suggestedExams: SuggestedExam[] = [];
  const newChunkIds: number[] = [];
  let unchanged = 0;
  let errors = 0;
  const seen = new Set<string>();

  const skip = (url: string, reason: string) => {
    skipped.push({ url, reason });
  };

  const persistDoc = (
    url: string,
    mime: string,
    contentHash: string,
    extracted: ExtractedDocument,
    extraMeta?: Record<string, unknown>,
  ): "inserted" | "unchanged" => {
    const existing = ctx.repo.getDocumentBySourceUrl(sourceId, url);
    if (existing?.content_hash === contentHash) {
      ctx.repo.touchDocument(existing.id);
      return "unchanged";
    }
    const persisted = persistExtracted(ctx.repo, {
      sourceId,
      courseId: source.course_id,
      url,
      mime,
      contentHash,
      extracted,
      extraMeta,
    });
    newChunkIds.push(...persisted.chunkIds);
    return "inserted";
  };

  onProgress(0.05, `Canvas: ${course.name}`, skipped);

  onProgress(0.1, "front page", skipped);
  try {
    const front = await client.getFrontPage(courseIdNum);
    if (front) {
      const result = persistPage(front, courseIdNum, persistDoc, suggestedExams);
      if (result === "unchanged") {
        unchanged += 1;
      }
      if (front.html_url) {
        seen.add(front.html_url);
      }
      if (front.url) {
        seen.add(`page:${front.url}`);
      }
    }
  } catch (err) {
    errors += 1;
    skip(`${client.baseUrl}/courses/${courseIdNum}`, errMessage(err));
  }

  onProgress(0.2, "pages", skipped);
  try {
    const pages = await client.listPages(courseIdNum);
    for (const summary of pages) {
      if (seen.has(`page:${summary.url}`) || (summary.html_url && seen.has(summary.html_url))) {
        continue;
      }
      if (summary.locked_for_user) {
        skip(summary.html_url || summary.url, "locked");
        continue;
      }
      try {
        const page = await client.getPage(courseIdNum, summary.url);
        const result = persistPage(page, courseIdNum, persistDoc, suggestedExams);
        if (result === "unchanged") {
          unchanged += 1;
        }
        if (page.html_url) {
          seen.add(page.html_url);
        }
        seen.add(`page:${page.url}`);
      } catch (err) {
        errors += 1;
        skip(summary.html_url || summary.url, errMessage(err));
      }
    }
  } catch (err) {
    errors += 1;
    skip(`${client.baseUrl}/courses/${courseIdNum}/pages`, errMessage(err));
  }

  onProgress(0.4, "modules", skipped);
  let modules: CanvasModule[] = [];
  try {
    modules = await client.listModules(courseIdNum);
  } catch (err) {
    errors += 1;
    skip(`${client.baseUrl}/courses/${courseIdNum}/modules`, errMessage(err));
  }

  const fileIdsFromModules = new Set<number>();
  for (const mod of modules) {
    if (mod.state === "locked") {
      skip(`${client.baseUrl}/courses/${courseIdNum}/modules/${mod.id}`, "locked module");
      continue;
    }
    for (const item of mod.items ?? []) {
      const itemUrl = item.html_url || item.external_url || item.url || `module-item:${item.id}`;
      if (item.content_details?.locked) {
        skip(itemUrl, "locked");
        continue;
      }
      if (item.type === "File" && item.content_id != null) {
        fileIdsFromModules.add(Number(item.content_id));
      }
      if (item.type === "ExternalTool" || item.type === "LtiExternalTool") {
        skip(itemUrl, LTI_SKIP);
        continue;
      }
      if (item.type === "SubHeader" || item.type === "Discussion" || item.type === "Quiz") {
        continue;
      }
      if (item.type === "ExternalUrl" && item.external_url) {
        skip(item.external_url, "external URL (add as website source if public)");
      }
    }
  }

  onProgress(0.55, "files", skipped);
  try {
    const listed = await client.listFiles(courseIdNum);
    if (listed.via === "modules") {
      skip(
        `${client.baseUrl}/api/v1/courses/${courseIdNum}/files`,
        "files list forbidden (403); using module items",
      );
    }
    const files =
      listed.files.length > 0 ? listed.files : await filesById(client, fileIdsFromModules);
    for (const file of files) {
      try {
        const result = await persistFile(
          client,
          file,
          courseIdNum,
          moduleNameForFile(file, modules),
          persistDoc,
          skip,
        );
        if (result === "unchanged") {
          unchanged += 1;
        } else if (result === "error") {
          errors += 1;
        }
      } catch (err) {
        errors += 1;
        skip(file.html_url || String(file.id), errMessage(err));
      }
    }
  } catch (err) {
    errors += 1;
    skip(`${client.baseUrl}/courses/${courseIdNum}/files`, errMessage(err));
  }

  onProgress(0.75, "assignments", skipped);
  let groups: Awaited<ReturnType<CanvasClient["listAssignmentGroups"]>> = [];
  try {
    groups = await client.listAssignmentGroups(courseIdNum);
  } catch {
    groups = [];
  }
  try {
    const assignments = await client.listAssignments(courseIdNum);
    for (const assignment of assignments) {
      const htmlUrl = assignment.html_url || `assignment:${assignment.id}`;
      if (assignment.locked_for_user) {
        skip(htmlUrl, "locked");
        continue;
      }
      const exam = examFromAssignment(assignment, groups);
      if (exam) {
        suggestedExams.push(exam);
      }
      if (!assignment.description?.trim()) {
        continue;
      }
      try {
        const extracted = extractCanvasHtml(assignment.description, htmlUrl, assignment.name, {
          course_id: Number(courseIdNum),
          item_type: "assignment",
          item_id: assignment.id,
        });
        const hash = sha256(new TextEncoder().encode(assignment.description));
        const result = persistDoc(htmlUrl, MIME_HTML, hash, extracted, {
          canvas: { item_type: "assignment", item_id: assignment.id },
        });
        if (result === "unchanged") {
          unchanged += 1;
        }
        const fromBody = suggestExams(extracted.segments.map((s) => s.text).join("\n"));
        suggestedExams.push(...fromBody);
      } catch (err) {
        errors += 1;
        skip(htmlUrl, errMessage(err));
      }
    }
  } catch (err) {
    errors += 1;
    skip(`${client.baseUrl}/courses/${courseIdNum}/assignments`, errMessage(err));
  }

  onProgress(0.88, "announcements", skipped);
  try {
    const announcements = await client.listAnnouncements([courseIdNum]);
    for (const post of announcements) {
      const htmlUrl = post.html_url || `announcement:${post.id}`;
      const body = post.message ?? "";
      if (!body.trim()) {
        continue;
      }
      try {
        const extracted = extractCanvasHtml(body, htmlUrl, post.title, {
          course_id: Number(courseIdNum),
          item_type: "announcement",
          item_id: post.id,
        });
        const hash = sha256(new TextEncoder().encode(body));
        const result = persistDoc(htmlUrl, MIME_HTML, hash, extracted, {
          canvas: { item_type: "announcement", item_id: post.id },
        });
        if (result === "unchanged") {
          unchanged += 1;
        }
      } catch (err) {
        errors += 1;
        skip(htmlUrl, errMessage(err));
      }
    }
  } catch (err) {
    errors += 1;
    skip(`${client.baseUrl}/api/v1/announcements`, errMessage(err));
  }

  const docs = ctx.repo.countDocuments(sourceId);
  const chunks = ctx.repo.countChunksForSource(sourceId);
  onProgress(1, `Indexed ${docs} Canvas document(s)`, skipped);
  return {
    docs,
    chunks,
    skipped,
    errors,
    unchanged,
    newChunkIds,
    suggestedExams: dedupeExams(suggestedExams),
  };
}

function openClient(fetchFn?: FetchLike): CanvasClient {
  const creds = loadCanvasCredentials();
  if (!creds) {
    throw new CanvasApiError({ code: "canvas_not_configured" });
  }
  return createCanvasClient(creds, { fetchFn });
}

function persistPage(
  page: CanvasPage,
  courseId: string,
  persistDoc: (
    url: string,
    mime: string,
    contentHash: string,
    extracted: ExtractedDocument,
    extraMeta?: Record<string, unknown>,
  ) => "inserted" | "unchanged",
  suggestedExams: SuggestedExam[],
): "inserted" | "unchanged" {
  const htmlUrl = page.html_url || page.url;
  const body = page.body ?? "";
  const extracted = extractCanvasHtml(body, htmlUrl, page.title, {
    course_id: Number(courseId),
    item_type: "page",
    item_id: page.url,
  });
  const fromBody = suggestExams(extracted.segments.map((s) => s.text).join("\n"));
  suggestedExams.push(...fromBody);
  const hash = sha256(new TextEncoder().encode(body || page.title));
  return persistDoc(htmlUrl, MIME_HTML, hash, extracted, {
    canvas: { item_type: "page", item_id: page.url, front_page: page.front_page === true },
  });
}

async function persistFile(
  client: CanvasClient,
  file: CanvasFile,
  courseId: string,
  moduleName: string | undefined,
  persistDoc: (
    url: string,
    mime: string,
    contentHash: string,
    extracted: ExtractedDocument,
    extraMeta?: Record<string, unknown>,
  ) => "inserted" | "unchanged",
  skip: (url: string, reason: string) => void,
): Promise<"inserted" | "unchanged" | "skipped" | "error"> {
  const htmlUrl = file.html_url || file.url || `file:${file.id}`;
  if (file.media_entry_id) {
    skip(htmlUrl, "media comment skipped");
    return "skipped";
  }
  if (file.locked || file.hidden) {
    skip(htmlUrl, "locked");
    return "skipped";
  }
  const downloaded = await client.downloadFile(file);
  const hash = sha256(downloaded.bytes);
  const name = file.display_name || file.filename || `file-${file.id}`;
  const kind = routeFetchedKind(
    downloaded.contentType || file.content_type || "",
    name,
    downloaded.bytes,
  );
  const canvasLoc: NonNullable<Locator["canvas"]> = {
    course_id: Number(courseId),
    item_type: "file",
    item_id: file.id,
    module: moduleName,
  };
  let extracted: ExtractedDocument;
  let mime = downloaded.contentType.split(";")[0]?.trim() || file.content_type || "";
  if (kind === "pdf") {
    extracted = await extractPdf(downloaded.bytes, htmlUrl, name);
    mime = MIME_PDF;
  } else if (kind === "pptx") {
    extracted = await extractPptx(downloaded.bytes, htmlUrl, name);
    mime = MIME_PPTX;
  } else {
    const extKind = supportedKind(name);
    const text = Buffer.from(downloaded.bytes).toString("utf8");
    if (extKind === "markdown") {
      extracted = extractMarkdown(text, htmlUrl, name);
    } else if (extKind === "txt" || kind === "html") {
      extracted = extractPlainText(text, htmlUrl, name, mime || "text/plain");
    } else {
      skip(htmlUrl, `unsupported type (${mime || basename(name)})`);
      return "skipped";
    }
  }
  extracted = withCanvasLocator(extracted, htmlUrl, name, canvasLoc);
  return persistDoc(htmlUrl, mime, hash, extracted, {
    canvas: canvasLoc,
  });
}

async function filesById(client: CanvasClient, ids: Set<number>): Promise<CanvasFile[]> {
  const files: CanvasFile[] = [];
  for (const id of ids) {
    try {
      files.push(await client.getFile(id));
    } catch {
      // unpublished
    }
  }
  return files;
}

function moduleNameForFile(file: CanvasFile, modules: CanvasModule[]): string | undefined {
  for (const mod of modules) {
    for (const item of mod.items ?? []) {
      if (item.type === "File" && Number(item.content_id) === Number(file.id)) {
        return mod.name;
      }
    }
  }
  return undefined;
}

function examFromAssignment(
  assignment: CanvasAssignment,
  groups: Array<{ id: number; name: string; group_weight?: number | null }>,
): SuggestedExam | null {
  if (!/midterm|final|\bexam\b/i.test(assignment.name)) {
    return null;
  }
  const date = assignment.due_at ? assignment.due_at.slice(0, 10) : null;
  const group = groups.find((g) => g.id === assignment.assignment_group_id);
  const name = /final/i.test(assignment.name)
    ? "Final"
    : /midterm/i.test(assignment.name)
      ? "Midterm"
      : assignment.name;
  const weight = group?.group_weight != null ? ` weight=${group.group_weight}` : "";
  return {
    name,
    date,
    evidence: `${assignment.name}${assignment.due_at ? ` due ${assignment.due_at}` : ""}${weight}`,
  };
}

function dedupeExams(exams: SuggestedExam[]): SuggestedExam[] {
  const seen = new Set<string>();
  const out: SuggestedExam[] = [];
  for (const exam of exams) {
    const key = `${exam.name}|${exam.date ?? exam.evidence}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(exam);
  }
  return out;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
