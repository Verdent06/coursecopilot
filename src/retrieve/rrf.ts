import { RRF_K } from "./config.js";

/** Reciprocal Rank Fusion: score(d) = Σ 1/(k + rank) with 1-based ranks. */
export function reciprocalRankFusion(
  rankedLists: number[][],
  k: number = RRF_K,
): Map<number, number> {
  const scores = new Map<number, number>();
  for (const list of rankedLists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return scores;
}

export type AdjacentHit = {
  chunk_id: number;
  document_id: string;
  ord: number;
  score: number;
};

/**
 * Drop the lower-scoring of two adjacent chunks from the same document
 * (spec §8: "Dedupe adjacent chunks from the same document").
 */
export function dedupeAdjacent<T extends AdjacentHit>(hits: T[]): T[] {
  const sorted = [...hits].sort((a, b) => b.score - a.score || a.chunk_id - b.chunk_id);
  const kept: T[] = [];
  for (const hit of sorted) {
    const clash = kept.some(
      (other) => other.document_id === hit.document_id && Math.abs(other.ord - hit.ord) === 1,
    );
    if (!clash) {
      kept.push(hit);
    }
  }
  kept.sort((a, b) => b.score - a.score || a.chunk_id - b.chunk_id);
  return kept;
}
