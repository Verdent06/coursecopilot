import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { EMBED_BATCH, EMBED_DIM, EMBED_MODEL_ID } from "../retrieve/config.js";
import { log } from "../util/log.js";
import { getHfCacheDir, getLocalModelPath } from "../util/paths.js";

export type EmbedderStatus = "idle" | "downloading" | "ready" | "unavailable";

export type Embedder = {
  readonly status: EmbedderStatus;
  readonly degraded: boolean;
  ready(): Promise<boolean>;
  embed(texts: string[]): Promise<Float32Array[] | null>;
};

type WorkerRequest = { type: "init" } | { type: "embed"; id: number; texts: string[] };

type WorkerReply =
  | { type: "status"; status: "downloading" | "ready" | "error"; message?: string }
  | { type: "embed"; id: number; ok: true; embeddings: number[][] }
  | { type: "embed"; id: number; ok: false; error: string };

/** Deterministic 384-dim bag-of-words vector for tests (no ONNX). */
export function hashEmbed(text: string): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const a = (h >>> 0) % EMBED_DIM;
    const b = ((h >>> 8) >>> 0) % EMBED_DIM;
    v[a] += 1;
    v[b] += 0.5;
  }
  return l2Normalize(v);
}

export function hashEmbedder(): Embedder {
  return {
    status: "ready",
    degraded: false,
    async ready() {
      return true;
    },
    async embed(texts: string[]) {
      return texts.map((t) => hashEmbed(t));
    },
  };
}

export function disabledEmbedder(): Embedder {
  return {
    status: "unavailable",
    degraded: true,
    async ready() {
      return false;
    },
    async embed() {
      return null;
    },
  };
}

/**
 * Local MiniLM embedder. Prefers a worker thread (spec §8), falls back to
 * in-process Transformers.js, then FTS-only if ONNX cannot load.
 */
export class TransformersEmbedder implements Embedder {
  status: EmbedderStatus = "idle";
  degraded = false;
  private worker: Worker | null = null;
  private initPromise: Promise<boolean> | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }
  >();
  private inProcess: ((texts: string[]) => Promise<Float32Array[]>) | null | undefined;

  async ready(): Promise<boolean> {
    if (this.status === "ready") {
      return true;
    }
    if (this.status === "unavailable") {
      return false;
    }
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    return this.initPromise;
  }

  async embed(texts: string[]): Promise<Float32Array[] | null> {
    if (texts.length === 0) {
      return [];
    }
    const ok = await this.ready();
    if (!ok) {
      return null;
    }
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const rows = await this.embedBatch(batch);
      if (!rows) {
        return null;
      }
      out.push(...rows);
    }
    return out;
  }

  private async init(): Promise<boolean> {
    if (process.env.COURSECOPILOT_DISABLE_EMBEDDINGS === "1") {
      this.markUnavailable("embeddings disabled by COURSECOPILOT_DISABLE_EMBEDDINGS");
      return false;
    }
    this.status = "downloading";
    const workerFile = workerScriptPath();
    if (existsSync(workerFile)) {
      try {
        const ok = await this.startWorker(workerFile);
        if (ok) {
          return true;
        }
      } catch (err) {
        log.warn("embedding worker failed; trying in-process", err);
        this.teardownWorker();
      }
    }
    try {
      await this.ensureInProcess();
      this.status = "ready";
      this.degraded = false;
      return true;
    } catch (err) {
      this.markUnavailable(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  private startWorker(file: string): Promise<boolean> {
    return new Promise((resolve) => {
      const worker = new Worker(file, {
        workerData: embedderEnv(),
      });
      this.worker = worker;
      const timeout = setTimeout(() => {
        log.warn("embedding worker init timed out");
        this.teardownWorker();
        resolve(false);
      }, 180_000);
      const onMsg = (msg: WorkerReply) => {
        if (msg.type === "status") {
          if (msg.status === "downloading") {
            this.status = "downloading";
            return;
          }
          if (msg.status === "ready") {
            clearTimeout(timeout);
            this.status = "ready";
            this.degraded = false;
            resolve(true);
            return;
          }
          if (msg.status === "error") {
            clearTimeout(timeout);
            log.warn("embedding worker error", msg.message);
            this.teardownWorker();
            resolve(false);
          }
          return;
        }
        if (msg.type === "embed") {
          const pending = this.pending.get(msg.id);
          if (!pending) {
            return;
          }
          this.pending.delete(msg.id);
          if (msg.ok) {
            pending.resolve(msg.embeddings.map((row) => Float32Array.from(row)));
          } else {
            pending.reject(new Error(msg.error));
          }
        }
      };
      worker.on("message", onMsg);
      worker.on("error", (err) => {
        log.warn("embedding worker crashed", err);
        clearTimeout(timeout);
        this.failPending(err);
        this.teardownWorker();
        resolve(false);
      });
      worker.on("exit", (code) => {
        if (this.worker === worker) {
          this.failPending(new Error(`embedding worker exited (${code})`));
          this.worker = null;
        }
      });
      worker.postMessage({ type: "init" } satisfies WorkerRequest);
    });
  }

  private async embedBatch(texts: string[]): Promise<Float32Array[] | null> {
    if (this.worker) {
      const id = this.nextId++;
      try {
        return await new Promise<Float32Array[]>((resolve, reject) => {
          this.pending.set(id, { resolve, reject });
          this.worker?.postMessage({ type: "embed", id, texts } satisfies WorkerRequest);
        });
      } catch (err) {
        log.warn("worker embed failed; trying in-process", err);
        this.teardownWorker();
        return this.embedInProcess(texts);
      }
    }
    return this.embedInProcess(texts);
  }

  private async embedInProcess(texts: string[]): Promise<Float32Array[] | null> {
    try {
      const run = await this.ensureInProcess();
      return run(texts);
    } catch (err) {
      this.markUnavailable(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private async ensureInProcess(): Promise<(texts: string[]) => Promise<Float32Array[]>> {
    if (this.inProcess) {
      return this.inProcess;
    }
    const run = await createInProcessRunner((status) => {
      if (status === "downloading") {
        this.status = "downloading";
      }
    });
    this.inProcess = run;
    return run;
  }

  private teardownWorker(): void {
    if (this.worker) {
      const w = this.worker;
      this.worker = null;
      w.terminate().catch(() => undefined);
    }
  }

  private failPending(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    for (const p of this.pending.values()) {
      p.reject(error);
    }
    this.pending.clear();
  }

  private markUnavailable(reason: string): void {
    this.status = "unavailable";
    this.degraded = true;
    log.warn("vector embeddings unavailable; FTS-only fallback", reason);
  }
}

let defaultEmbedder: Embedder | undefined;

export function createDefaultEmbedder(): Embedder {
  if (process.env.COURSECOPILOT_DISABLE_EMBEDDINGS === "1") {
    return disabledEmbedder();
  }
  if (!defaultEmbedder) {
    defaultEmbedder = new TransformersEmbedder();
  }
  return defaultEmbedder;
}

export function embedderEnv(): {
  cacheDir: string;
  modelId: string;
  localModelPath: string | null;
} {
  const local = getLocalModelPath();
  return {
    cacheDir: getHfCacheDir(),
    modelId: local && isLocalModelDir(local) ? local : EMBED_MODEL_ID,
    localModelPath: local ?? null,
  };
}

export function isLocalModelDir(path: string): boolean {
  return existsSync(join(path, "config.json")) || existsSync(join(path, "tokenizer.json"));
}

function workerScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "embed-worker.js");
}

function l2Normalize(v: Float32Array): Float32Array {
  let ss = 0;
  for (let i = 0; i < v.length; i++) {
    ss += (v[i] ?? 0) * (v[i] ?? 0);
  }
  const n = Math.sqrt(ss) || 1;
  for (let i = 0; i < v.length; i++) {
    v[i] = (v[i] ?? 0) / n;
  }
  return v;
}

type ProgressFn = (status: "downloading" | "ready") => void;

async function createInProcessRunner(
  onStatus: ProgressFn,
): Promise<(texts: string[]) => Promise<Float32Array[]>> {
  const transformers = await import("@huggingface/transformers");
  configureTransformersEnv(transformers.env);
  onStatus("downloading");
  const cfg = embedderEnv();
  const extractor = await transformers.pipeline("feature-extraction", cfg.modelId, {
    progress_callback: (info: { status?: string }) => {
      if (info.status === "progress" || info.status === "download" || info.status === "initiate") {
        onStatus("downloading");
      }
    },
  });
  onStatus("ready");
  return async (texts: string[]) => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return tensorToRows(output);
  };
}

export function configureTransformersEnv(env: {
  cacheDir: string | null;
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  localModelPath?: string;
}): void {
  const cfg = embedderEnv();
  env.cacheDir = cfg.cacheDir;
  env.allowLocalModels = true;
  if (cfg.localModelPath && isLocalModelDir(cfg.localModelPath)) {
    env.allowRemoteModels = false;
    env.localModelPath = dirname(cfg.localModelPath);
  } else if (cfg.localModelPath) {
    env.cacheDir = cfg.localModelPath;
    env.allowRemoteModels = false;
  } else {
    env.allowRemoteModels = true;
  }
}

export function tensorToRows(output: { data: ArrayLike<number>; dims: number[] }): Float32Array[] {
  const data = output.data;
  const dims = output.dims;
  const dim = dims[dims.length - 1] ?? EMBED_DIM;
  const rows = dims.length >= 2 ? (dims[0] ?? 1) : 1;
  const out: Float32Array[] = [];
  for (let i = 0; i < rows; i++) {
    const row = new Float32Array(dim);
    for (let j = 0; j < dim; j++) {
      row[j] = Number(data[i * dim + j] ?? 0);
    }
    out.push(row);
  }
  return out;
}
