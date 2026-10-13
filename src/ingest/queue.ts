import { type CourseRepo, RepoError } from "../db/repo.js";
import { newId } from "../util/ids.js";
import { log } from "../util/log.js";
import { nowIso } from "../util/time.js";
import { ingestFileSource } from "./sources/file.js";
import type { IngestResult, SkipReason } from "./types.js";

export type IngestQueueOptions = {
  repo: CourseRepo;
  allowLocalPaths?: boolean;
};

const UNIMPLEMENTED: Record<string, string> = {
  website: "website ingestion is not implemented yet (milestone M4)",
  youtube: "YouTube ingestion is not implemented yet (milestone M5)",
  transcript: "transcript ingestion is not implemented yet (milestone M5)",
  canvas: "Canvas ingestion is not implemented yet (milestone M6)",
};

/**
 * In-process serial job queue. add_source returns a job_id immediately; work
 * continues on the event loop so MCP tool calls never block for minutes.
 */
export class IngestQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly allowLocalPaths: boolean;

  constructor(private readonly opts: IngestQueueOptions) {
    this.allowLocalPaths = opts.allowLocalPaths ?? true;
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
    if (source.kind !== "file" && source.kind !== "folder") {
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
      const result: IngestResult = await ingestFileSource(
        { repo: this.opts.repo, allowLocalPaths: this.allowLocalPaths },
        job.source_id,
        persistProgress,
      );
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
  if (state === "error") {
    return `Failed: 0 documents ingested (${result.errors} error(s), ${skip} skipped)`;
  }
  if (state === "partial") {
    return `Partial: ${result.docs} document(s), ${result.chunks} chunk(s), ${result.errors} error(s), ${skip} skipped`;
  }
  if (skip > 0) {
    return `Indexed ${result.docs} document(s), ${result.chunks} chunk(s), ${skip} skipped`;
  }
  return `Indexed ${result.docs} document(s), ${result.chunks} chunk(s)`;
}
