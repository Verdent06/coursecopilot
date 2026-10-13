import { type CourseRepo, RepoError } from "../db/repo.js";
import { EMBED_BATCH } from "../retrieve/config.js";
import { newId } from "../util/ids.js";
import { log } from "../util/log.js";
import { nowIso } from "../util/time.js";
import type { FetchLike } from "./crawl/fetch.js";
import type { Embedder } from "./embed.js";
import { ingestFileSource } from "./sources/file.js";
import { ingestTranscriptSource } from "./sources/transcript.js";
import { ingestWebsiteSource } from "./sources/website.js";
import { ingestYoutubeSource } from "./sources/youtube.js";
import { extractAndAssignTopics } from "./topics.js";
import type { IngestResult, SkipReason } from "./types.js";
import type { YoutubeClient } from "./youtube/client.js";

export type IngestQueueOptions = {
  repo: CourseRepo;
  allowLocalPaths?: boolean;
  embedder?: Embedder | null;
  youtube?: YoutubeClient;
  allowPrivateNetwork?: boolean;
  crawlDelayMs?: number;
  fetchFn?: FetchLike;
};

const UNIMPLEMENTED: Record<string, string> = {
  canvas: "Canvas ingestion is not implemented yet (milestone M6)",
};

/**
 * In-process serial job queue. add_source returns a job_id immediately; work
 * continues on the event loop so MCP tool calls never block for minutes.
 */
export class IngestQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly allowLocalPaths: boolean;
  private readonly embedder: Embedder | null;
  private readonly allowPrivateNetwork: boolean;
  private readonly crawlDelayMs: number | undefined;
  private readonly fetchFn: FetchLike | undefined;

  constructor(private readonly opts: IngestQueueOptions) {
    this.allowLocalPaths = opts.allowLocalPaths ?? true;
    this.embedder = opts.embedder ?? null;
    this.allowPrivateNetwork = opts.allowPrivateNetwork ?? true;
    this.crawlDelayMs = opts.crawlDelayMs;
    this.fetchFn = opts.fetchFn;
  }

  /** Validate kind and persist a queued job, then schedule it. */
  submit(sourceId: string): string {
    const source = this.opts.repo.getSource(sourceId);
    if (!source) {
      throw new RepoError(`Unknown source_id "${sourceId}"`);
    }
    const unimplemented = UNIMPLEMENTED[source.kind];
    if (unimplemented) {
      throw new RepoError(unimplemented);
    }
    if (
      source.kind !== "file" &&
      source.kind !== "folder" &&
      source.kind !== "website" &&
      source.kind !== "youtube" &&
      source.kind !== "transcript"
    ) {
      throw new RepoError(`Unsupported source kind "${source.kind}"`);
    }
    const jobId = `job_${newId()}`;
    this.opts.repo.insertJob({
      id: jobId,
      source_id: sourceId,
      state: "queued",
      progress: 0,
      message: "queued",
    });
    this.schedule(jobId);
    return jobId;
  }

  async waitForIdle(): Promise<void> {
    await this.tail;
  }

  private schedule(jobId: string): void {
    this.tail = this.tail.then(async () => {
      try {
        await this.run(jobId);
      } catch (err) {
        log.error("ingest job failed", err);
      }
    });
  }

  private async run(jobId: string): Promise<void> {
    const job = this.opts.repo.getJob(jobId);
    if (!job) {
      return;
    }
    const started = nowIso();
    this.opts.repo.updateJob(jobId, {
      state: "running",
      progress: 0,
      message: "starting",
      started_at: started,
    });
    this.opts.repo.updateSource(job.source_id, { status: "running" });

    const persistProgress = (progress: number, message: string, skipped: SkipReason[]) => {
      this.opts.repo.updateJob(jobId, {
        progress,
        message,
        result_json: JSON.stringify({ skipped }),
      });
    };

    try {
      const result: IngestResult = await this.ingest(job.source_id, persistProgress);
      try {
        await this.embedSource(
          job.source_id,
          persistProgress,
          result.skipped,
          result.newChunkIds,
        );
      } catch (err) {
        log.warn("embedding step failed; leaving FTS-only index", err);
      }
      try {
        const source = this.opts.repo.getSource(job.source_id);
        if (source) {
          persistProgress(0.97, "extracting topics", result.skipped);
          await extractAndAssignTopics(this.opts.repo, source.course_id, this.embedder);
        }
      } catch (err) {
        log.warn("topic heuristic failed", err);
      }
      const state = finishState(result);
      const message = finishMessage(state, result);
      this.opts.repo.updateJob(jobId, {
        state,
        progress: 1,
        message,
        finished_at: nowIso(),
        result_json: JSON.stringify({
          docs: result.docs,
          chunks: result.chunks,
          skipped: result.skipped,
          unchanged: result.unchanged ?? 0,
          suggested_exams: result.suggestedExams ?? [],
        }),
      });
      this.opts.repo.updateSource(job.source_id, {
        status: state,
        error: state === "error" ? message : null,
        last_synced_at: state === "error" ? null : nowIso(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.repo.updateJob(jobId, {
        state: "error",
        progress: 1,
        message,
        finished_at: nowIso(),
        result_json: JSON.stringify({ docs: 0, chunks: 0, skipped: [] }),
      });
      this.opts.repo.updateSource(job.source_id, { status: "error", error: message });
    }
  }

  private async ingest(
    sourceId: string,
    persistProgress: (progress: number, message: string, skipped: SkipReason[]) => void,
  ): Promise<IngestResult> {
    const source = this.opts.repo.getSource(sourceId);
    if (!source) {
      throw new RepoError(`Unknown source_id "${sourceId}"`);
    }
    if (source.kind === "website") {
      return ingestWebsiteSource(
        {
          repo: this.opts.repo,
          allowPrivateNetwork: this.allowPrivateNetwork,
          delayMs: this.crawlDelayMs,
          fetchFn: this.fetchFn,
        },
        sourceId,
        persistProgress,
      );
    }
    if (source.kind === "file" || source.kind === "folder") {
      return ingestFileSource(
        { repo: this.opts.repo, allowLocalPaths: this.allowLocalPaths },
        sourceId,
        persistProgress,
      );
    }
    if (source.kind === "youtube") {
      return ingestYoutubeSource(
        { repo: this.opts.repo, youtube: this.opts.youtube },
        sourceId,
        persistProgress,
      );
    }
    if (source.kind === "transcript") {
      return ingestTranscriptSource(
        { repo: this.opts.repo, allowLocalPaths: this.allowLocalPaths },
        sourceId,
        persistProgress,
      );
    }
    throw new RepoError(`Unsupported source kind "${source.kind}"`);
  }

  private async embedSource(
    sourceId: string,
    persistProgress: (progress: number, message: string, skipped: SkipReason[]) => void,
    skipped: SkipReason[],
    newChunkIds?: number[],
  ): Promise<void> {
    const embedder = this.embedder;
    if (!embedder || embedder.degraded) {
      return;
    }
    const chunks =
      newChunkIds === undefined
        ? this.opts.repo.listChunksForSource(sourceId)
        : this.opts.repo.listChunksByIds(newChunkIds);
    if (chunks.length === 0) {
      return;
    }
    persistProgress(0.85, "downloading embedding model", skipped);
    const ready = await embedder.ready();
    if (!ready) {
      persistProgress(0.95, "keyword index ready (embeddings unavailable)", skipped);
      return;
    }
    persistProgress(0.9, `embedding ${chunks.length} chunk(s)`, skipped);
    const vectors: Array<{ id: number; embedding: Float32Array; course_id: string }> = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const texts = batch.map((c) => c.text);
      const embedded = await embedder.embed(texts);
      if (!embedded) {
        persistProgress(0.95, "keyword index ready (embeddings unavailable)", skipped);
        return;
      }
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const vec = embedded[j];
        if (chunk && vec) {
          vectors.push({ id: chunk.id, embedding: vec, course_id: chunk.course_id });
        }
      }
      persistProgress(
        0.9 + 0.08 * ((i + batch.length) / chunks.length),
        `embedding ${Math.min(i + batch.length, chunks.length)}/${chunks.length} chunk(s)`,
        skipped,
      );
    }
    try {
      this.opts.repo.insertEmbeddings(vectors);
    } catch (err) {
      log.warn("failed to store embeddings; FTS-only for this source", err);
    }
  }
}

function finishState(result: IngestResult): "done" | "partial" | "error" {
  if (result.docs > 0 && result.errors > 0) {
    return "partial";
  }
  if (result.docs === 0 && result.errors > 0) {
    return "error";
  }
  return "done";
}

function finishMessage(state: string, result: IngestResult): string {
  const skip = result.skipped.length;
  const unchangedCount = result.unchanged ?? 0;
  const unchanged = unchangedCount > 0 ? `, ${unchangedCount} unchanged` : "";
  const exams = result.suggestedExams ?? [];
  const examNote =
    exams.length > 0
      ? `. Suggested exams (not set automatically): ${exams.map((e) => (e.date ? `${e.name} ${e.date}` : e.name)).join(", ")}. Call set_exam to add them.`
      : "";
  if (state === "error") {
    return `Failed: 0 documents ingested (${result.errors} error(s), ${skip} skipped)`;
  }
  if (state === "partial") {
    return `Partial: ${result.docs} document(s), ${result.chunks} chunk(s), ${result.errors} error(s), ${skip} skipped${unchanged}${examNote}`;
  }
  if (skip > 0 || unchangedCount > 0) {
    return `Indexed ${result.docs} document(s), ${result.chunks} chunk(s), ${skip} skipped${unchanged}${examNote}`;
  }
  return `Indexed ${result.docs} document(s), ${result.chunks} chunk(s)${examNote}`;
}
