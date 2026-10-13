import { describe, expect, it } from "vitest";
import { RRF_K } from "../../src/retrieve/config.js";
import { dedupeAdjacent, reciprocalRankFusion } from "../../src/retrieve/rrf.js";

describe("reciprocal rank fusion", () => {
  it("sums 1/(k+rank) across lists and prefers items in both", () => {
    const scores = reciprocalRankFusion([
      [10, 20, 30],
      [20, 10, 40],
    ]);
    expect(scores.get(20)).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1));
    expect(scores.get(10)).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2));
    expect(scores.get(30)).toBeCloseTo(1 / (RRF_K + 3));
    expect((scores.get(20) ?? 0) > (scores.get(30) ?? 0)).toBe(true);
  });

  it("drops the lower-scoring adjacent chunk from the same document", () => {
    const kept = dedupeAdjacent([
      { chunk_id: 1, document_id: "d", ord: 4, score: 0.9 },
      { chunk_id: 2, document_id: "d", ord: 5, score: 0.4 },
      { chunk_id: 3, document_id: "e", ord: 0, score: 0.5 },
    ]);
    expect(kept.map((h) => h.chunk_id)).toEqual([1, 3]);
  });
});
