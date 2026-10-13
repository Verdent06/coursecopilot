import type { SourceKind } from "../db/repo.js";
import { MIME_PDF, MIME_PPTX } from "../ingest/mime.js";
import type { Locator } from "../ingest/types.js";
import { extractVideoId, youtuBeUrl } from "../ingest/youtube/parse.js";
import { formatTimestamp } from "../util/timestamp.js";

export type ChunkCitationRow = {
  id: number;
  document_id: string;
  source_id: string;
  source_kind: SourceKind;
  mime: string | null;
  doc_title: string | null;
  doc_url: string | null;
  course_title: string | null;
  heading_path: string | null;
  locator_json: string;
  meta_json: string | null;
};

export type CitationKind =
  | "pdf"
  | "pptx"
  | "web"
  | "canvas"
  | "youtube"
  | "transcript"
  | "file"
  | "lecture";

export type Citation = {
  label: string;
  kind: CitationKind;
  url: string;
  title: string;
  page: number | null;
  slide: number | null;
  anchor: string | null;
  start_s: number | null;
  end_s: number | null;
  source_id: string;
  document_id: string;
  chunk_id: number;
};

export type CitationInput = {
  chunk_id: number;
  document_id: string;
  source_id: string;
  source_kind: SourceKind;
  mime: string | null;
  doc_title: string | null;
  doc_url: string | null;
  course_title: string | null;
  heading_path: string | null;
  locator: Locator;
  meta?: Record<string, unknown>;
};

export function parseLocator(raw: string): Locator {
  try {
    const parsed = JSON.parse(raw) as Locator;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** True when a PDF should be cited as slides (pack flag, extractor heuristic, or locator.slide). */
export function isSlideDeckPdf(input: {
  mime?: string | null;
  locator: Locator;
  meta?: Record<string, unknown>;
}): boolean {
  if (input.locator.slide != null) {
    return true;
  }
  if (input.meta?.as_slides === true) {
    return true;
  }
  return false;
}

export function citationKind(input: CitationInput): CitationKind {
  const mime = (input.mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === MIME_PDF || mime === "application/x-pdf") {
    return "pdf";
  }
  if (mime === MIME_PPTX || mime.includes("presentationml")) {
    return "pptx";
  }
  if (input.source_kind === "canvas") {
    return "canvas";
  }
  if (input.source_kind === "youtube") {
    return "youtube";
  }
  if (input.source_kind === "transcript") {
    return "transcript";
  }
  if (input.source_kind === "leccap") {
    return "lecture";
  }
  if (input.source_kind === "website" || mime === "text/html") {
    return "web";
  }
  if (input.locator.page != null) {
    return "pdf";
  }
  if (input.locator.slide != null) {
    return "pptx";
  }
  return "file";
}

export function citationFromChunkRow(row: ChunkCitationRow): Citation {
  return buildCitation({
    chunk_id: row.id,
    document_id: row.document_id,
    source_id: row.source_id,
    source_kind: row.source_kind,
    mime: row.mime,
    doc_title: row.doc_title,
    doc_url: row.doc_url,
    course_title: row.course_title,
    heading_path: row.heading_path,
    locator: parseLocator(row.locator_json) as Locator,
    meta: parseMeta(row.meta_json),
  });
}

export function buildCitation(input: CitationInput): Citation {
  const loc = input.locator;
  const kind = citationKind(input);
  const title =
    loc.title || input.doc_title || filenameFromUri(loc.path || loc.url || input.doc_url);
  const slides =
    kind === "pptx" || isSlideDeckPdf({ mime: input.mime, locator: loc, meta: input.meta });
  const page = loc.page ?? null;
  const slide = loc.slide ?? (slides && page != null ? page : null);
  const url = citationUrl({ kind, loc, docUrl: input.doc_url, page, slide, slides });
  const where = locationLabel({ kind, loc, headingPath: input.heading_path, page, slide, slides });
  const label = buildLabel(input.course_title, title, where, kind, loc);
  return {
    label,
    kind,
    url,
    title,
    page,
    slide,
    anchor: loc.anchor ?? null,
    start_s: loc.start_s ?? null,
    end_s: loc.end_s ?? null,
    source_id: input.source_id,
    document_id: input.document_id,
    chunk_id: input.chunk_id,
  };
}

function buildLabel(
  courseTitle: string | null,
  title: string,
  where: string | null,
  kind: CitationKind,
  loc: Locator,
): string {
  if (kind === "canvas" || loc.canvas) {
    const module = loc.canvas?.module;
    const item = loc.title || title;
    const extra = where && item !== where ? where : null;
    const inner = ["Canvas", module, item, extra].filter(Boolean).join(" · ");
    return `[${inner}]`;
  }
  if (kind === "lecture") {
    return lectureLabel(courseTitle, title, loc);
  }
  const parts = [courseTitle, title, where].filter((p): p is string => Boolean(p?.trim()));
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(part);
  }
  return `[${unique.join(" · ")}]`;
}

function locationLabel(input: {
  kind: CitationKind;
  loc: Locator;
  headingPath: string | null;
  page: number | null;
  slide: number | null;
  slides: boolean;
}): string | null {
  if (input.kind === "youtube" || input.kind === "transcript") {
    if (input.loc.start_s != null) {
      return formatTimestamp(input.loc.start_s);
    }
    return null;
  }
  if (input.kind === "lecture") {
    const bits: string[] = [];
    if (input.loc.start_s != null) {
      bits.push(`@ ${formatTimestamp(input.loc.start_s)}`);
    }
    if (input.slide != null) {
      bits.push(`slide ${input.slide}`);
    }
    return bits.length > 0 ? bits.join(", ") : null;
  }
  if (input.slide != null && (input.kind === "pptx" || input.slides || input.kind === "pdf")) {
    return `slide ${input.slide}`;
  }
  if (input.page != null) {
    return `p. ${input.page}`;
  }
  if (input.kind === "web") {
    const heading = lastHeading(input.headingPath);
    return heading || (input.loc.anchor ? `#${input.loc.anchor}` : null);
  }
  return null;
}

function citationUrl(input: {
  kind: CitationKind;
  loc: Locator;
  docUrl: string | null;
  page: number | null;
  slide: number | null;
  slides: boolean;
}): string {
  const base = input.loc.url || input.docUrl || input.loc.path || "";
  if (input.kind === "lecture") {
    const base = stripHash(input.loc.url || input.docUrl || "");
    if (!base) {
      return "";
    }
    const t = input.loc.start_s != null ? Math.floor(input.loc.start_s) : null;
    if (t != null && t > 0) {
      return `${base}#t=${t}`;
    }
    return base;
  }
  if (input.kind === "youtube") {
    const id = input.loc.video_id || extractVideoId(base);
    const t = input.loc.start_s != null ? Math.floor(input.loc.start_s) : null;
    if (id) {
      return youtuBeUrl(id, t);
    }
    if (t != null && base) {
      const join = base.includes("?") ? "&" : "?";
      return `${stripHash(base)}${join}t=${t}s`;
    }
    return base;
  }
  if ((input.kind === "pdf" || input.slides) && input.page != null && base) {
    return `${stripHash(base)}#page=${input.page}`;
  }
  if (input.kind === "web" && input.loc.anchor && base) {
    return `${stripHash(base)}#${input.loc.anchor}`;
  }
  return base;
}

function lectureLabel(courseTitle: string | null, title: string, loc: Locator): string {
  const lecture = loc.title || title;
  const where: string[] = [];
  if (loc.start_s != null) {
    where.push(`@ ${formatTimestamp(loc.start_s)}`);
  }
  if (loc.slide != null) {
    where.push(`slide ${loc.slide}`);
  }
  const lectureAndWhere =
    where.length > 0 ? `${lecture} ${where[0]}${where[1] ? `, ${where[1]}` : ""}` : lecture;
  const pdf =
    loc.pdf_title && loc.page != null
      ? `(${loc.pdf_title} p. ${loc.page})`
      : loc.pdf_title
        ? `(${loc.pdf_title})`
        : null;
  const parts = [courseTitle, lectureAndWhere, pdf].filter((p): p is string => Boolean(p?.trim()));
  return `[${parts.join(" – ")}]`;
}

function lastHeading(path: string | null): string | null {
  if (!path) {
    return null;
  }
  const parts = path
    .split(">")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function filenameFromUri(uri: string | null | undefined): string {
  if (!uri) {
    return "document";
  }
  try {
    const path = uri.replace(/^file:\/\//, "").split("?")[0] ?? uri;
    const name = path.split("/").filter(Boolean).pop() ?? path;
    return decodeURIComponent(name);
  } catch {
    return uri;
  }
}

function stripHash(url: string): string {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}
