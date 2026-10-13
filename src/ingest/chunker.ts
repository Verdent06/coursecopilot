import { OVERLAP_TOKENS, TARGET_TOKENS, WORD_TOKEN_FACTOR } from "./config.js";
import type { ExtractedSegment, Locator } from "./types.js";

export function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Approximate token count: words × 1.3 (spec §8). */
export function estimateTokens(text: string): number {
  return Math.ceil(splitWords(text).length * WORD_TOKEN_FACTOR);
}

function targetWordCount(tokens: number): number {
  return Math.max(1, Math.round(tokens / WORD_TOKEN_FACTOR));
}

/**
 * Split one structural segment (a page, slide, or heading section) into ~350-token
 * windows with ~50-token overlap. Never called across a page/slide boundary.
 */
export function chunkSegment(text: string): string[] {
  const words = splitWords(text);
  if (words.length === 0) {
    return [];
  }
  const window = targetWordCount(TARGET_TOKENS);
  const overlap = targetWordCount(OVERLAP_TOKENS);
  if (words.length <= window) {
    return [words.join(" ")];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(words.length, start + window);
    chunks.push(words.slice(start, end).join(" "));
    if (end >= words.length) {
      break;
    }
    const next = end - overlap;
    start = next <= start ? start + 1 : next;
  }
  return chunks;
}

export type PreparedChunk = {
  text: string;
  locator: Locator;
  headingPath: string;
  tokenCount: number;
  ord: number;
};

/** Flatten extracted segments into ordered chunks, one locator per chunk. */
export function chunksFromSegments(segments: ExtractedSegment[]): PreparedChunk[] {
  const out: PreparedChunk[] = [];
  let ord = 0;
  for (const segment of segments) {
    for (const text of chunkSegment(segment.text)) {
      out.push({
        text,
        locator: segment.locator,
        headingPath: segment.headingPath,
        tokenCount: estimateTokens(text),
        ord,
      });
      ord += 1;
    }
  }
  return out;
}
