import { describe, expect, it } from "vitest";
import {
  chunkSegment,
  chunksFromSegments,
  estimateTokens,
  splitWords,
} from "../../src/ingest/chunker.js";
import { OVERLAP_TOKENS, TARGET_TOKENS, WORD_TOKEN_FACTOR } from "../../src/ingest/config.js";

describe("chunker", () => {
  it("estimates tokens as words × 1.3", () => {
    expect(estimateTokens("one two three")).toBe(Math.ceil(3 * WORD_TOKEN_FACTOR));
  });

  it("returns a single chunk when under the target window", () => {
    expect(chunkSegment("short text")).toEqual(["short text"]);
  });

  it("splits long text to ~350 tokens with ~50 overlap and never stalls", () => {
    const words = Array.from({ length: 800 }, (_, i) => `w${i}`);
    const chunks = chunkSegment(words.join(" "));
    expect(chunks.length).toBeGreaterThan(1);
    const window = Math.round(TARGET_TOKENS / WORD_TOKEN_FACTOR);
    const overlap = Math.round(OVERLAP_TOKENS / WORD_TOKEN_FACTOR);
    const first = splitWords(chunks[0] ?? "");
    expect(first.length).toBe(window);
    const second = splitWords(chunks[1] ?? "");
    expect(second[0]).toBe(first[first.length - overlap]);
    expect(chunks.join(" ")).toContain("w0");
    expect(chunks.join(" ")).toContain("w799");
  });

  it("does not cross a page boundary: each segment keeps its locator", () => {
    const prepared = chunksFromSegments([
      { text: "alpha page", locator: { path: "file:///a.pdf", page: 1 }, headingPath: "Page 1" },
      { text: "beta page", locator: { path: "file:///a.pdf", page: 2 }, headingPath: "Page 2" },
    ]);
    expect(prepared).toHaveLength(2);
    expect(prepared[0]?.locator.page).toBe(1);
    expect(prepared[1]?.locator.page).toBe(2);
    expect(prepared[0]?.ord).toBe(0);
    expect(prepared[1]?.ord).toBe(1);
  });
});
