import { type CourseRepo, RepoError, type SourceKind } from "../db/repo.js";
import type { Embedder } from "../ingest/embed.js";
import type { Locator } from "../ingest/types.js";
import { log } from "../util/log.js";
import { buildCitation, type Citation, parseLocator, parseMeta } from "./citation.js";
import { DEFAULT_K, FTS_CANDIDATES, MAX_K, TOPIC_BOOST, VEC_CANDIDATES } from "./config.js";
import { ftsMatchQuery } from "./fts.js";
import { dedupeAdjacent, reciprocalRankFusion } from "./rrf.js";

export type SearchQuery = {
  query: string;
  course_id?: string;
  k?: number;
  source_kinds?: SourceKind[];
  topic?: string;
};

export type SearchHit = {
  chunk_id: number;
  text: string;
  score: number;
  citation: Citation;
};

export type SearchResult = {
  results: SearchHit[];
  degraded?: "keyword_only";
};

export type ChunkView = {
  chunk_id: number;
  text: string;
  document_id: string;
  ord: number;
  citation: Citation;
};

export type GetChunkResult = {
  chunk: ChunkView;
  neighbors: ChunkView[];
  citation: Citation;
};

export type GetDocumentResult = {
  document_id: string;
  title: string;
  mime: string | null;
  url: string | null;
  text: string;
  chunks: ChunkView[];
};

export class HybridSearch {
  constructor(
    private readonly repo: CourseRepo,
    private readonly embedder: Embedder | null,
    private readonly vecEnabled: boolean,
  ) {}

  async search(input: SearchQuery): Promise<SearchResult> {
    const courseId = this.repo.resolveCourseId(input.course_id);
    const k = clampK(input.k);
    const query = input.query.trim();
    if (!query) {
      return { results: [] };
    }

    const ftsIds = this.ftsCandidates(courseId, query, input.source_kinds);
    let vecIds: number[] = [];
    let degraded: "keyword_only" | undefined;

    const canVec = this.vecEnabled && this.embedder && !this.embedder.degraded;
    if (canVec) {
      const ready = await this.embedder?.ready();
      if (ready && this.embedder) {
        try {
          vecIds = await this.vecCandidates(courseId, query, input.source_kinds);
        } catch (err) {
          log.warn("vector search failed; using FTS only", err);
          degraded = "keyword_only";
        }
      } else {
        degraded = "keyword_only";
      }
    } else {
      degraded = "keyword_only";
    }

    const lists = [ftsIds, vecIds].filter((list) => list.length > 0);
    const fused = reciprocalRankFusion(lists);
    if (input.topic) {
      for (const [id, score] of fused) {
        if (this.repo.chunkMatchesTopic(id, courseId, input.topic)) {
          fused.set(id, score * TOPIC_BOOST);
        }
      }
    }

    const ids = [...fused.keys()];
    const details = this.repo.getChunkDetails(ids);
    const byId = new Map(details.map((d) => [d.id, d]));
    const scored = [...fused.entries()]
      .map(([id, score]) => {
        const row = byId.get(id);
        if (!row) {
          return null;
        }
        if (input.source_kinds && input.source_kinds.length > 0) {
          if (!input.source_kinds.includes(row.source_kind)) {
            return null;
          }
        }
        return { row, score };
      })
      .filter((x): x is { row: (typeof details)[number]; score: number } => x != null);

    const deduped = dedupeAdjacent(
      scored.map((s) => ({
        chunk_id: s.row.id,
        document_id: s.row.document_id,
        ord: s.row.ord,
        score: s.score,
        row: s.row,
      })),
    ).slice(0, k);

    const results: SearchHit[] = deduped.map((hit) => ({
      chunk_id: hit.chunk_id,
      text: hit.row.text,
      score: roundScore(hit.score),
      citation: citationFromDetail(hit.row),
    }));

    return degraded ? { results, degraded } : { results };
  }

  getChunk(chunkId: number, context = 1): GetChunkResult {
    const row = this.repo.getChunkDetail(chunkId);
    if (!row) {
      throw new RepoError(`Unknown chunk_id "${chunkId}"`);
    }
    const neighbors = this.repo
      .listNeighborChunks(row.document_id, row.ord, context)
      .filter((n) => n.id !== row.id);
    const chunk = toView(row);
    return {
      chunk,
      neighbors: neighbors.map(toView),
      citation: chunk.citation,
    };
  }

  getDocument(documentId: string): GetDocumentResult {
    const doc = this.repo.getDocument(documentId);
    if (!doc) {
      throw new RepoError(`Unknown document_id "${documentId}"`);
    }
    const chunks = this.repo.listChunksForDocument(documentId);
    const views = chunks.map(toView);
    return {
      document_id: doc.id,
      title: doc.title ?? views[0]?.citation.title ?? documentId,
      mime: doc.mime,
      url: doc.url,
      text: views.map((v) => v.text).join("\n\n"),
      chunks: views,
    };
  }

  private ftsCandidates(courseId: string, query: string, sourceKinds?: SourceKind[]): number[] {
    const match = ftsMatchQuery(query);
    if (!match) {
      return [];
    }
    return this.repo.searchFts(courseId, match, FTS_CANDIDATES, sourceKinds);
  }

  private async vecCandidates(
    courseId: string,
    query: string,
    sourceKinds?: SourceKind[],
  ): Promise<number[]> {
    if (!this.embedder) {
      return [];
    }
    const vectors = await this.embedder.embed([query]);
    const q = vectors?.[0];
    if (!q) {
      return [];
    }
    return this.repo.searchVec(courseId, q, VEC_CANDIDATES, sourceKinds);
  }
}

function clampK(k: number | undefined): number {
  if (k == null || Number.isNaN(k)) {
    return DEFAULT_K;
  }
  return Math.min(MAX_K, Math.max(1, Math.floor(k)));
}

function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}

function citationFromDetail(row: {
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
}): Citation {
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

function toView(
  row: Parameters<typeof citationFromDetail>[0] & { text: string; ord: number },
): ChunkView {
  return {
    chunk_id: row.id,
    text: row.text,
    document_id: row.document_id,
    ord: row.ord,
    citation: citationFromDetail(row),
  };
}
