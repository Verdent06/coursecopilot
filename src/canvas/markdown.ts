import { extractHtml } from "../ingest/sources/html.js";
import type { ExtractedDocument, Locator } from "../ingest/types.js";

export function wrapCanvasHtml(title: string, body: string): string {
  if (/<html[\s>]/i.test(body)) {
    return body;
  }
  const safeTitle = title.replace(/</g, "&lt;");
  return `<!doctype html><html><head><title>${safeTitle}</title></head><body>${body}</body></html>`;
}

export function htmlToMarkdown(
  html: string,
  pageUrl: string,
  title?: string,
): {
  title: string;
  markdown: string;
} {
  const extracted = extractHtml(wrapCanvasHtml(title ?? "", html), pageUrl);
  return {
    title: title || extracted.title,
    markdown: extracted.segments
      .map((s) => s.text)
      .join("\n\n")
      .trim(),
  };
}

export function extractCanvasHtml(
  html: string,
  pageUrl: string,
  title: string,
  canvas: NonNullable<Locator["canvas"]>,
): ExtractedDocument {
  const extracted = extractHtml(wrapCanvasHtml(title, html), pageUrl);
  return {
    ...extracted,
    title: title || extracted.title,
    segments: extracted.segments.map((segment) => ({
      ...segment,
      locator: {
        ...segment.locator,
        url: pageUrl,
        title,
        canvas,
      },
    })),
  };
}

export function withCanvasLocator(
  extracted: ExtractedDocument,
  pageUrl: string,
  title: string,
  canvas: NonNullable<Locator["canvas"]>,
): ExtractedDocument {
  return {
    ...extracted,
    title: title || extracted.title,
    segments: extracted.segments.map((segment) => ({
      ...segment,
      locator: {
        ...segment.locator,
        url: pageUrl,
        title: segment.locator.title || title,
        canvas,
      },
    })),
  };
}
