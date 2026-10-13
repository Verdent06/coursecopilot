import type { ExtractedSegment, Locator } from "../types.js";
import type { MatchedPdfSlide, OcrFn, PdfSlideCandidate, SlideChange } from "./types.js";

/** Last slide whose start is <= t (thumbnails are a slide-change timeline). */
export function slideAtTime(slides: SlideChange[], t: number): SlideChange | undefined {
  if (slides.length === 0) {
    return undefined;
  }
  let current = slides[0];
  for (const s of slides) {
    if (s.start_s <= t) {
      current = s;
    } else {
      break;
    }
  }
  return current;
}

export function attachSlidesToSegments(
  segments: ExtractedSegment[],
  slides: SlideChange[],
): ExtractedSegment[] {
  return segments.map((seg) => {
    const t = seg.locator.start_s ?? 0;
    const slide = slideAtTime(slides, t);
    if (!slide) {
      return seg;
    }
    return {
      ...seg,
      locator: { ...seg.locator, slide: slide.slideIndex },
    };
  });
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "are",
  "was",
  "were",
  "have",
  "has",
  "not",
  "but",
  "you",
  "your",
  "our",
  "let",
  "use",
  "using",
  "slide",
  "lecture",
  "page",
]);

export function tokenizeSlideText(text: string): Set<string> {
  const out = new Set<string>();
  for (const tok of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (tok.length < 4 || STOP.has(tok)) {
      continue;
    }
    out.add(tok);
  }
  return out;
}

/**
 * How much of `a`'s significant tokens appear in `b`.
 * OCR is usually a noisy subset of a PDF slide, so recall beats Jaccard.
 */
export function textOverlap(a: string, b: string): number {
  const sa = tokenizeSlideText(a);
  const sb = tokenizeSlideText(b);
  if (sa.size === 0 || sb.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) {
      inter += 1;
    }
  }
  return inter / sa.size;
}

export function matchOcrToPdf(
  ocrText: string,
  candidates: PdfSlideCandidate[],
  minScore = 0.45,
): MatchedPdfSlide | null {
  const cleaned = ocrText.trim();
  if (cleaned.length < 12 || candidates.length === 0) {
    return null;
  }
  const ocrTokens = tokenizeSlideText(cleaned);
  if (ocrTokens.size < 4) {
    return null;
  }
  let best: MatchedPdfSlide | null = null;
  for (const c of candidates) {
    const score = textOverlap(cleaned, c.text);
    if (score < minScore) {
      continue;
    }
    if (!best || score > best.score) {
      best = {
        title: c.title,
        page: c.page,
        slide: c.slide ?? c.page,
        score,
      };
    }
  }
  return best;
}

export async function ocrSlideImages(
  slideImageUrls: Record<number, string>,
  needed: Iterable<number>,
  fetchBytes: (url: string) => Promise<Uint8Array | null>,
  ocr: OcrFn,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique = [...new Set(needed)];
  for (const idx of unique) {
    const url = slideImageUrls[idx];
    if (!url) {
      continue;
    }
    try {
      const bytes = await fetchBytes(url);
      if (!bytes || bytes.byteLength === 0) {
        continue;
      }
      const text = (await ocr(bytes)).replace(/\s+/g, " ").trim();
      if (text) {
        out.set(idx, text);
      }
    } catch {
      // OCR is optional; a single failed slide must not fail the recording.
    }
  }
  return out;
}

export function applyOcrAndPdfMatch(
  segments: ExtractedSegment[],
  ocrBySlide: Map<number, string>,
  pdfCandidates: PdfSlideCandidate[],
): ExtractedSegment[] {
  return segments.map((seg) => {
    const slide = seg.locator.slide;
    if (slide == null) {
      return seg;
    }
    const ocr = ocrBySlide.get(slide);
    if (!ocr) {
      return seg;
    }
    const match = matchOcrToPdf(ocr, pdfCandidates);
    const locator: Locator = { ...seg.locator };
    if (match) {
      locator.pdf_title = match.title;
      if (match.page != null) {
        locator.page = match.page;
      }
    }
    const prefix = `[Slide ${slide}: ${ocr}]`;
    const text = seg.text.startsWith("[Slide ") ? seg.text : `${prefix}\n${seg.text}`;
    return { ...seg, text, locator };
  });
}
