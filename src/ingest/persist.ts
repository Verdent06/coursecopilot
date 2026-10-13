import type { CourseRepo } from "../db/repo.js";
import { newId } from "../util/ids.js";
import { nowIso } from "../util/time.js";
import { chunksFromSegments } from "./chunker.js";
import type { ExtractedDocument } from "./types.js";

export function lectureNoFromConfig(configJson: string | null): number | undefined {
  if (!configJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(configJson) as { lecture_no?: unknown };
    return typeof parsed.lecture_no === "number" ? parsed.lecture_no : undefined;
  } catch {
    return undefined;
  }
}

/** Insert one extracted document and its chunks. Returns the chunk count. */
export function persistExtractedDocument(
  repo: CourseRepo,
  input: {
    sourceId: string;
    courseId: string;
    url: string;
    extracted: ExtractedDocument;
    contentHash: string;
    lectureNo?: number;
  },
): number {
  const meta = { ...input.extracted.meta };
  if (input.lectureNo != null) {
    meta.lecture_no = input.lectureNo;
  }
  const prepared = chunksFromSegments(input.extracted.segments);
  const docId = newId();
  repo.insertDocument({
    id: docId,
    source_id: input.sourceId,
    course_id: input.courseId,
    url: input.url,
    title: input.extracted.title,
    mime: input.extracted.mime || null,
    content_hash: input.contentHash,
    fetched_at: nowIso(),
    meta_json: JSON.stringify(meta),
  });
  repo.insertChunks(
    prepared.map((chunk) => ({
      document_id: docId,
      course_id: input.courseId,
      ord: chunk.ord,
      text: chunk.text,
      locator_json: JSON.stringify(chunk.locator),
      heading_path: chunk.headingPath,
      token_count: chunk.tokenCount,
    })),
  );
  return prepared.length;
}
