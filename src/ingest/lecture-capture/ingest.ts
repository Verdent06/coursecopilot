import type { CourseRepo } from "../../db/repo.js";
import { parseLocator } from "../../retrieve/citation.js";
import { sha256 } from "../hash.js";
import { lectureNoFromConfig, persistExtracted } from "../persist.js";
import type { ProgressFn } from "../sources/file.js";
import { cuesToSegments } from "../sources/vtt.js";
import type { ExtractedDocument, IngestResult, SkipReason } from "../types.js";
import { lectureCaptionsToCues } from "./captions.js";
import { applyOcrAndPdfMatch, attachSlidesToSegments, ocrSlideImages } from "./slides.js";
import type { LectureCaptureProvider, LectureProduct, OcrFn, PdfSlideCandidate } from "./types.js";
import { SessionExpiredError } from "./types.js";

export type LectureCaptureIngestOptions = {
  repo: CourseRepo;
  provider: LectureCaptureProvider;
  sourceId: string;
  onProgress?: ProgressFn;
  ocr?: OcrFn | null;
  fetchSlideBytes?: (url: string) => Promise<Uint8Array | null>;
  collectPdfCandidates?: boolean;
  includeWhiteboard?: boolean;
};

export async function ingestLectureCaptureSource(
  opts: LectureCaptureIngestOptions,
): Promise<IngestResult> {
  const source = opts.repo.getSource(opts.sourceId);
  if (!source) {
    throw new Error(`Unknown source_id "${opts.sourceId}"`);
  }
  const parsed = opts.provider.parseUrl(source.uri);
  if (!parsed) {
    throw new Error(`Not a ${opts.provider.id} site or recording URL: "${source.uri}"`);
  }

  const onProgress = opts.onProgress ?? (() => undefined);
  const skipped: SkipReason[] = [];
  const lectureNo = lectureNoFromConfig(source.config_json);
  const pdfCandidates =
    opts.collectPdfCandidates === false ? [] : collectPdfCandidates(opts.repo, source.course_id);

  let refs: Array<{ recordingId: string; title?: string; url: string }>;
  if (parsed.kind === "recording" && parsed.recordingId) {
    refs = [
      {
        recordingId: parsed.recordingId,
        url: parsed.canonical,
      },
    ];
  } else if (parsed.siteId) {
    onProgress(0.05, `Listing recordings for site ${parsed.siteId}`, skipped);
    const listed = await opts.provider.listRecordings(parsed.siteId);
    refs = listed.map((r) => ({ recordingId: r.recordingId, title: r.title, url: r.url }));
    if (listed[0]?.siteName) {
      opts.repo.updateSource(opts.sourceId, { title: listed[0].siteName });
    }
  } else {
    throw new Error(`Could not determine a site or recording id from "${source.uri}"`);
  }

  if (refs.length === 0) {
    skipped.push({ url: parsed.canonical, reason: "No recordings found for this site." });
    return { docs: 0, chunks: 0, skipped, errors: 1 };
  }

  let errors = 0;
  let unchanged = 0;
  const newChunkIds: number[] = [];

  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (!ref) {
      continue;
    }
    onProgress((i + 1) / (refs.length + 1), `Fetching ${ref.recordingId}`, skipped);
    try {
      const product = await opts.provider.fetchProduct(ref.recordingId);
      const hash = sha256(product.hashMaterial);
      const playerUrl = product.playerUrl;
      const already = opts.repo.getDocumentBySourceUrl(opts.sourceId, playerUrl);
      if (already?.content_hash === hash) {
        opts.repo.touchDocument(already.id);
        unchanged += 1;
        continue;
      }
      const extracted = await extractRecording(product, {
        lectureNo,
        ocr: opts.ocr ?? null,
        fetchSlideBytes: opts.fetchSlideBytes ?? opts.provider.fetchBytes,
        pdfCandidates,
        includeWhiteboard: opts.includeWhiteboard ?? false,
        provider: opts.provider,
      });
      if ("skip" in extracted) {
        skipped.push({ url: playerUrl, reason: extracted.skip });
        errors += 1;
        continue;
      }
      const persisted = persistExtracted(opts.repo, {
        sourceId: opts.sourceId,
        courseId: source.course_id,
        url: playerUrl,
        mime: extracted.mime,
        contentHash: hash,
        extracted,
        extraMeta: lectureNo != null ? { lecture_no: lectureNo } : undefined,
      });
      newChunkIds.push(...persisted.chunkIds);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        throw err;
      }
      errors += 1;
      skipped.push({
        url: ref.url,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const docs = opts.repo.countDocuments(opts.sourceId);
  const chunks = opts.repo.countChunksForSource(opts.sourceId);
  onProgress(1, `Indexed ${docs} recording(s), ${chunks} chunk(s)`, skipped);
  return { docs, chunks, skipped, errors, unchanged, newChunkIds };
}

async function extractRecording(
  product: LectureProduct,
  opts: {
    lectureNo?: number;
    ocr: OcrFn | null;
    fetchSlideBytes?: (url: string) => Promise<Uint8Array | null>;
    pdfCandidates: PdfSlideCandidate[];
    includeWhiteboard: boolean;
    provider: LectureCaptureProvider;
  },
): Promise<ExtractedDocument | { skip: string }> {
  if (product.captions.length === 0) {
    return {
      skip: "No captions on this recording (product captions array empty and WebVTT missing). Export a .vtt and add it with kind=transcript.",
    };
  }

  const lectureLabel = lectureLabelFromProduct(product, opts.lectureNo);
  const deepBase = opts.provider.playerDeepLink(product.playerUrl, null);
  const cues = lectureCaptionsToCues(product.captions);
  let segments = cuesToSegments(
    cues,
    { url: deepBase, recording_id: product.recordingId, title: lectureLabel },
    lectureLabel,
  );
  segments = attachSlidesToSegments(segments, product.slides);

  if (opts.ocr && opts.fetchSlideBytes && Object.keys(product.slideImageUrls).length > 0) {
    const needed = segments.map((s) => s.locator.slide).filter((n): n is number => n != null);
    const ocrBySlide = await ocrSlideImages(
      product.slideImageUrls,
      needed,
      opts.fetchSlideBytes,
      opts.ocr,
    );
    segments = applyOcrAndPdfMatch(segments, ocrBySlide, opts.pdfCandidates);
  }

  for (const seg of segments) {
    const t = seg.locator.start_s;
    seg.locator.url = opts.provider.playerDeepLink(product.playerUrl, t);
  }

  const meta: Record<string, unknown> = {
    lecture_no: opts.lectureNo,
    published_at: product.date,
    duration_s: product.duration_s,
    recording_id: product.recordingId,
    site_id: product.siteId,
    site_name: product.siteName,
    slide_count: product.slides.length,
    caption_kind: "product",
  };
  if (opts.includeWhiteboard) {
    meta.aux_sources = product.auxSources;
  } else if (product.auxSources.length > 0) {
    meta.aux_sources = product.auxSources.map((a) => ({
      kind: a.kind,
      prefix: a.prefix,
      count: a.count,
      interval_s: a.interval_s,
    }));
  }

  return {
    title: lectureLabel,
    mime: "text/vtt",
    segments,
    meta,
  };
}

export function lectureLabelFromProduct(
  product: { title: string; date?: string },
  lectureNo?: number,
): string {
  if (lectureNo != null) {
    return `Lecture ${lectureNo}`;
  }
  const fromTitle = /lecture\s+(\d+)/i.exec(product.title);
  if (fromTitle?.[1]) {
    return `Lecture ${fromTitle[1]}`;
  }
  const md = product.date?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (md) {
    return `Lecture ${Number(md[1])}/${Number(md[2])}`;
  }
  return product.title || "Lecture";
}

export function collectPdfCandidates(repo: CourseRepo, courseId: string): PdfSlideCandidate[] {
  const out: PdfSlideCandidate[] = [];
  const chunks = repo.listChunksForCourse(courseId);
  for (const chunk of chunks) {
    const loc = parseLocator(chunk.locator_json);
    if (loc.page == null && loc.slide == null) {
      continue;
    }
    if (loc.recording_id) {
      continue;
    }
    const title = loc.title || filenameFrom(loc.path || loc.url) || "slides";
    out.push({
      title,
      page: loc.page,
      slide: loc.slide,
      text: chunk.text,
      path: loc.path,
      url: loc.url,
    });
  }
  return out;
}

function filenameFrom(uri: string | undefined): string | null {
  if (!uri) {
    return null;
  }
  const name = uri.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return name ? decodeURIComponent(name.split("?")[0] ?? name) : null;
}
