import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { CourseRepo } from "../../db/repo.js";
import { RepoError } from "../../db/repo.js";
import { assertExists, resolveLocalPath, toFileUri, walkFiles } from "../../util/files.js";
import { newId } from "../../util/ids.js";
import { nowIso } from "../../util/time.js";
import { chunksFromSegments } from "../chunker.js";
import { FOLDER_FILE_CAP, MAX_FILE_BYTES } from "../config.js";
import { sha256 } from "../hash.js";
import { mimeForPath, supportedKind } from "../mime.js";
import type { ExtractedDocument, IngestResult, SkipReason } from "../types.js";
import { extractPdf } from "./pdf.js";
import { extractPptx } from "./pptx.js";
import { extractMarkdown, extractPlainText } from "./text.js";

export type ProgressFn = (progress: number, message: string, skipped: SkipReason[]) => void;

export type FileIngestContext = {
  repo: CourseRepo;
  allowLocalPaths: boolean;
};

export async function ingestFileSource(
  ctx: FileIngestContext,
  sourceId: string,
  onProgress: ProgressFn = () => undefined,
): Promise<IngestResult> {
  if (!ctx.allowLocalPaths) {
    throw new RepoError(
      "Local file paths are disabled unless --allow-path is set (remote mode). Use a website, pack, or Canvas source instead.",
    );
  }

  const source = ctx.repo.getSource(sourceId);
  if (!source) {
    throw new RepoError(`Unknown source_id "${sourceId}"`);
  }

  const abs = resolveLocalPath(source.uri);
  assertExists(abs);
  const st = statSync(abs);
  const lectureNo = lectureNoFromConfig(source.config_json);

  const skipped: SkipReason[] = [];
  let files: string[] = [];

  if (source.kind === "file") {
    if (st.isDirectory()) {
      throw new RepoError(`uri is a directory; use kind "folder" for ${abs}`);
    }
    files = [abs];
  } else if (source.kind === "folder") {
    if (!st.isDirectory()) {
      throw new RepoError(`uri is a file; use kind "file" for ${abs}`);
    }
    const walked = walkFiles(abs, FOLDER_FILE_CAP);
    files = walked.files;
    if (walked.truncated) {
      skipped.push({
        url: toFileUri(abs),
        reason: `folder file cap (${FOLDER_FILE_CAP}) exceeded; extra files skipped`,
      });
    }
  } else {
    throw new RepoError(`ingestFileSource cannot handle kind "${source.kind}"`);
  }

  if (files.length === 0) {
    onProgress(1, "No supported files found", skipped);
    return { docs: 0, chunks: 0, skipped, errors: 0 };
  }

  let docs = 0;
  let chunks = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    if (!filePath) {
      continue;
    }
    const fileUri = toFileUri(filePath);
    const frac = files.length === 0 ? 1 : i / files.length;
    onProgress(frac, `Reading ${basename(filePath)}`, skipped);

    const kind = supportedKind(filePath);
    if (!kind) {
      skipped.push({ url: fileUri, reason: `unsupported type (${basename(filePath)})` });
      continue;
    }

    let stFile: ReturnType<typeof statSync>;
    try {
      stFile = statSync(filePath);
    } catch (err) {
      errors += 1;
      skipped.push({ url: fileUri, reason: `stat failed: ${errMessage(err)}` });
      continue;
    }
    if (stFile.size > MAX_FILE_BYTES) {
      skipped.push({
        url: fileUri,
        reason: `file larger than ${MAX_FILE_BYTES} bytes`,
      });
      continue;
    }

    try {
      const bytes = new Uint8Array(readFileSync(filePath));
      const extracted = await extractBytes(kind, bytes, fileUri, filePath, {
        asSlides: asSlidesFromConfig(source.config_json),
      });
      if (lectureNo != null) {
        extracted.meta.lecture_no = lectureNo;
      }
      const prepared = chunksFromSegments(extracted.segments);
      const docId = newId();
      ctx.repo.insertDocument({
        id: docId,
        source_id: sourceId,
        course_id: source.course_id,
        url: fileUri,
        title: extracted.title,
        mime: extracted.mime || mimeForPath(filePath) || null,
        content_hash: sha256(bytes),
        fetched_at: nowIso(),
        meta_json: JSON.stringify(extracted.meta),
      });
      ctx.repo.insertChunks(
        prepared.map((chunk) => ({
          document_id: docId,
          course_id: source.course_id,
          ord: chunk.ord,
          text: chunk.text,
          locator_json: JSON.stringify(chunk.locator),
          heading_path: chunk.headingPath,
          token_count: chunk.tokenCount,
        })),
      );
      docs += 1;
      chunks += prepared.length;
    } catch (err) {
      errors += 1;
      skipped.push({ url: fileUri, reason: errMessage(err) });
    }
  }

  onProgress(1, `Indexed ${docs} document(s), ${chunks} chunk(s)`, skipped);
  return { docs, chunks, skipped, errors };
}

async function extractBytes(
  kind: NonNullable<ReturnType<typeof supportedKind>>,
  bytes: Uint8Array,
  fileUri: string,
  filePath: string,
  options: { asSlides?: boolean } = {},
): Promise<ExtractedDocument> {
  if (kind === "pdf") {
    return extractPdf(bytes, fileUri, filePath, { asSlides: options.asSlides });
  }
  if (kind === "pptx") {
    return extractPptx(bytes, fileUri, filePath);
  }
  const content = Buffer.from(bytes).toString("utf8");
  if (kind === "markdown") {
    return extractMarkdown(content, fileUri, filePath);
  }
  return extractPlainText(content, fileUri, filePath, mimeForPath(filePath) ?? "text/plain");
}

function asSlidesFromConfig(configJson: string | null): boolean | undefined {
  if (!configJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(configJson) as { as_slides?: unknown };
    return typeof parsed.as_slides === "boolean" ? parsed.as_slides : undefined;
  } catch {
    return undefined;
  }
}

function lectureNoFromConfig(configJson: string | null): number | undefined {
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

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
