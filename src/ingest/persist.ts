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

export type PersistInput = {
  sourceId: string;
  courseId: string;
  url: string;
  mime: string;
  contentHash: string;
  extracted: ExtractedDocument;
  extraMeta?: Record<string, unknown>;
};

export type PersistInserted = {
  outcome: "inserted" | "replaced";
  documentId: string;
  chunkIds: number[];
};

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
  const extraMeta = input.lectureNo != null ? { lecture_no: input.lectureNo } : undefined;
  const persisted = insertExtracted(repo, {
    sourceId: input.sourceId,
    courseId: input.courseId,
    url: input.url,
    mime: input.extracted.mime || null,
    contentHash: input.contentHash,
    extracted: input.extracted,
    extraMeta,
  });
  return persisted.chunkIds.length;
}

/** Insert or replace a document when the content hash changed. */
export function persistExtracted(repo: CourseRepo, input: PersistInput): PersistInserted {
  const existing = repo.getDocumentBySourceUrl(input.sourceId, input.url);
  if (existing) {
    repo.deleteDocument(existing.id);
  }
  const persisted = insertExtracted(repo, {
    sourceId: input.sourceId,
    courseId: input.courseId,
    url: input.url,
    mime: input.mime || input.extracted.mime,
    contentHash: input.contentHash,
    extracted: input.extracted,
    extraMeta: input.extraMeta,
  });
  return {
    outcome: existing ? "replaced" : "inserted",
    documentId: persisted.documentId,
    chunkIds: persisted.chunkIds,
  };
}

function insertExtracted(
  repo: CourseRepo,
  input: {
    sourceId: string;
    courseId: string;
    url: string;
    mime: string | null;
    contentHash: string;
    extracted: ExtractedDocument;
    extraMeta?: Record<string, unknown>;
  },
): { documentId: string; chunkIds: number[] } {
  const docId = newId();
  const meta = { ...input.extracted.meta, ...(input.extraMeta ?? {}) };
  const prepared = chunksFromSegments(input.extracted.segments);
  repo.insertDocument({
    id: docId,
    source_id: input.sourceId,
    course_id: input.courseId,
    url: input.url,
    title: input.extracted.title,
    mime: input.mime,
    content_hash: input.contentHash,
    fetched_at: nowIso(),
    meta_json: JSON.stringify(meta),
  });
  const chunkIds = repo.insertChunks(
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
  return { documentId: docId, chunkIds };
}

export function locatorsWithUrl(extracted: ExtractedDocument, url: string): ExtractedDocument {
  return {
    ...extracted,
    segments: extracted.segments.map((segment) => {
      const { path: _path, ...rest } = segment.locator;
      return { ...segment, locator: { ...rest, url } };
    }),
  };
}
