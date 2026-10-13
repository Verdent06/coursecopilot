/**
 * Worker thread: load MiniLM once and embed batches so the MCP stdio loop stays free.
 */
import { parentPort, workerData } from "node:worker_threads";
import { env, pipeline } from "@huggingface/transformers";
import { configureTransformersEnv, tensorToRows } from "./embed.js";

type Request = { type: "init" } | { type: "embed"; id: number; texts: string[] };

let extractor: Awaited<ReturnType<typeof pipeline<"feature-extraction">>> | null = null;

if (!parentPort) {
  throw new Error("embed-worker must run as a worker thread");
}

const port = parentPort;

if (workerData && typeof workerData === "object") {
  const data = workerData as { cacheDir?: string; localModelPath?: string | null };
  if (data.cacheDir) {
    process.env.HF_HOME = process.env.HF_HOME ?? data.cacheDir;
  }
  if (data.localModelPath) {
    process.env.COURSECOPILOT_MODEL_PATH =
      process.env.COURSECOPILOT_MODEL_PATH ?? data.localModelPath;
  }
}

port.on("message", (msg: Request) => {
  void handle(msg);
});

async function handle(msg: Request): Promise<void> {
  try {
    if (msg.type === "init") {
      await ensureExtractor();
      port.postMessage({ type: "status", status: "ready" });
      return;
    }
    if (msg.type === "embed") {
      const extractorFn = await ensureExtractor();
      const output = await extractorFn(msg.texts, { pooling: "mean", normalize: true });
      const rows = tensorToRows(output);
      port.postMessage({
        type: "embed",
        id: msg.id,
        ok: true,
        embeddings: rows.map((r) => Array.from(r)),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (msg.type === "embed") {
      port.postMessage({ type: "embed", id: msg.id, ok: false, error: message });
    } else {
      port.postMessage({ type: "status", status: "error", message });
    }
  }
}

async function ensureExtractor(): Promise<
  Awaited<ReturnType<typeof pipeline<"feature-extraction">>>
> {
  if (extractor) {
    return extractor;
  }
  configureTransformersEnv(env);
  port.postMessage({
    type: "status",
    status: "downloading",
    message: "downloading embedding model",
  });
  const modelId =
    typeof workerData === "object" && workerData && "modelId" in workerData
      ? String((workerData as { modelId: string }).modelId)
      : "Xenova/all-MiniLM-L6-v2";
  extractor = await pipeline("feature-extraction", modelId, {
    progress_callback: (info: { status?: string }) => {
      if (info.status === "progress" || info.status === "download" || info.status === "initiate") {
        port.postMessage({
          type: "status",
          status: "downloading",
          message: "downloading embedding model",
        });
      }
    },
  });
  return extractor;
}
