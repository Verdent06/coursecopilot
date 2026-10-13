import { homedir } from "node:os";
import { join } from "node:path";

export const DB_FILENAME = "cc.db";

/** Data directory: COURSECOPILOT_HOME, else ~/.coursecopilot */
export function getHomeDir(): string {
  return process.env.COURSECOPILOT_HOME ?? join(homedir(), ".coursecopilot");
}

export function getDbPath(): string {
  return join(getHomeDir(), DB_FILENAME);
}

/**
 * Transformers.js filesystem cache. Matches the CI cache path
 * `~/.cache/huggingface` (and HF_HOME / TRANSFORMERS_CACHE when set).
 */
export function getHfCacheDir(): string {
  return (
    process.env.HF_HOME ??
    process.env.TRANSFORMERS_CACHE ??
    join(homedir(), ".cache", "huggingface")
  );
}

/** Offline model directory. When set, remote Hugging Face downloads are skipped. */
export function getLocalModelPath(): string | undefined {
  const path = process.env.COURSECOPILOT_MODEL_PATH?.trim();
  return path || undefined;
}
