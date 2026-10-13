import { basename } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { OCR_CHAR_THRESHOLD } from "../config.js";
import { MIME_PDF } from "../mime.js";
import type { ExtractedDocument, ExtractedSegment } from "../types.js";

export type PdfExtractOptions = {
  /** Treat pages as slides (citation "slide N"). */
  asSlides?: boolean;
};

export async function extractPdf(
  bytes: Uint8Array,
  fileUri: string,
  filePath: string,
  options: PdfExtractOptions = {},
): Promise<ExtractedDocument> {
  const pdf = await getDocumentProxy(bytes);
  const extracted = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  const totalPages = extracted.totalPages || pages.length;
  const asSlides =
    options.asSlides === true
      ? true
      : options.asSlides === false
        ? false
        : await detectSlideDeckPdf(pdf, filePath);

  const segments: ExtractedSegment[] = [];
  let thinPages = 0;
  for (let i = 0; i < pages.length; i++) {
    const raw = pages[i] ?? "";
    const text = normalizeExtractedText(raw);
    if (text.length < OCR_CHAR_THRESHOLD) {
      thinPages += 1;
    }
    if (!text) {
      continue;
    }
    const page = i + 1;
    const locator = asSlides ? { path: fileUri, page, slide: page } : { path: fileUri, page };
    segments.push({
      text,
      locator,
      headingPath: asSlides ? `Slide ${page}` : `Page ${page}`,
    });
  }

  const needsOcr = totalPages > 0 && thinPages / totalPages > 0.5;
  const title = firstLine(segments[0]?.text) || basename(filePath);

  return {
    title,
    mime: MIME_PDF,
    segments,
    meta: {
      page_count: totalPages,
      needs_ocr: needsOcr,
      as_slides: asSlides,
    },
  };
}

/** Landscape pages or a "slide(s)" filename → cite as a slide deck (spec §10). */
export async function detectSlideDeckPdf(
  pdf: {
    numPages?: number;
    getPage?: (
      n: number,
    ) => Promise<{ getViewport: (opts: { scale: number }) => { width: number; height: number } }>;
  },
  filePath: string,
): Promise<boolean> {
  if (/(?:^|[^a-z0-9])slides?(?:[^a-z0-9]|$)/i.test(filePath)) {
    return true;
  }
  try {
    const n = Math.min(pdf.numPages || 1, 3);
    if (!pdf.getPage || n < 1) {
      return false;
    }
    let landscape = 0;
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      if (viewport.width > viewport.height) {
        landscape += 1;
      }
    }
    return landscape > n / 2;
  } catch {
    return false;
  }
}

function normalizeExtractedText(raw: string): string {
  return raw.replaceAll("\r\n", "\n").replaceAll("\0", "").trim();
}

function firstLine(text: string | undefined): string {
  if (!text) {
    return "";
  }
  const line = text.split("\n").find((l) => l.trim());
  return line?.trim().slice(0, 200) ?? "";
}
