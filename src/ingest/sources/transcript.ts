import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { CourseRepo } from "../../db/repo.js";
import { RepoError } from "../../db/repo.js";
import { assertExists, resolveLocalPath, toFileUri } from "../../util/files.js";
import { MAX_FILE_BYTES } from "../config.js";
import { sha256 } from "../hash.js";
import { lectureNoFromConfig, persistExtractedDocument } from "../persist.js";
import type { IngestResult, SkipReason } from "../types.js";
import type { ProgressFn } from "./file.js";
import { extractTranscript } from "./vtt.js";

export type TranscriptIngestContext = {
  repo: CourseRepo;
  allowLocalPaths: boolean;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
};

export async function ingestTranscriptSource(
  ctx: TranscriptIngestContext,
  sourceId: string,
  onProgress: ProgressFn = () => undefined,
): Promise<IngestResult> {
  const source = ctx.repo.getSource(sourceId);
  if (!source) {
    throw new RepoError(`Unknown source_id "${sourceId}"`);
  }
  if (source.kind !== "transcript") {
    throw new RepoError(`ingestTranscriptSource cannot handle kind "${source.kind}"`);
  }

  const skipped: SkipReason[] = [];
  const lectureNo = lectureNoFromConfig(source.config_json);
  onProgress(0.1, "Reading transcript", skipped);

  const loaded = await loadTranscript(ctx, source.uri);
  if (loaded.bytes.byteLength > MAX_FILE_BYTES) {
    skipped.push({
      url: loaded.url,
      reason: `file larger than ${MAX_FILE_BYTES} bytes`,
    });
    return { docs: 0, chunks: 0, skipped, errors: 1 };
  }

  const text = Buffer.from(loaded.bytes).toString("utf8");
  const extracted = extractTranscript(text, loaded.url, loaded.pathOrName, loaded.mime);
  if (extracted.segments.length === 0) {
    skipped.push({
      url: loaded.url,
      reason: "No cues found. File must be WebVTT or SubRip (.vtt / .srt).",
    });
    return { docs: 0, chunks: 0, skipped, errors: 1 };
  }
  if (lectureNo != null) {
    extracted.meta.lecture_no = lectureNo;
  }

  const chunks = persistExtractedDocument(ctx.repo, {
    sourceId,
    courseId: source.course_id,
    url: loaded.url,
    extracted,
    contentHash: sha256(loaded.bytes),
    lectureNo,
  });
  ctx.repo.updateSource(sourceId, { title: extracted.title });
  onProgress(1, `Indexed 1 transcript, ${chunks} chunk(s)`, skipped);
  return { docs: 1, chunks, skipped, errors: 0 };
}

async function loadTranscript(
  ctx: TranscriptIngestContext,
  uri: string,
): Promise<{ bytes: Uint8Array; url: string; pathOrName: string; mime?: string }> {
  if (/^https?:\/\//i.test(uri)) {
    const fetchImpl = ctx.fetch ?? fetch;
    const res = await fetchImpl(uri, { headers: { Accept: "text/vtt, text/plain, */*" } });
    if (!res.ok) {
      throw new RepoError(`Failed to fetch transcript ${uri}: HTTP ${res.status}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const name = basename(new URL(uri).pathname) || "transcript.vtt";
    const mime = res.headers.get("content-type") ?? mimeFromName(name);
    return { bytes: buf, url: uri, pathOrName: name, mime };
  }

  if (!ctx.allowLocalPaths) {
    throw new RepoError(
      "Local file paths are disabled unless --allow-path is set (remote mode). Use a website, pack, or Canvas source instead.",
    );
  }
  const abs = resolveLocalPath(uri);
  assertExists(abs);
  const st = statSync(abs);
  if (st.isDirectory()) {
    throw new RepoError(`uri is a directory; use a .vtt or .srt file for kind "transcript"`);
  }
  const bytes = new Uint8Array(readFileSync(abs));
  return {
    bytes,
    url: toFileUri(abs),
    pathOrName: abs,
    mime: mimeFromName(abs),
  };
}

function mimeFromName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".srt")) {
    return "application/x-subrip";
  }
  if (lower.endsWith(".vtt")) {
    return "text/vtt";
  }
  return undefined;
}
