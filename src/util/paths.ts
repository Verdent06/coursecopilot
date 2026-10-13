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

/** Playwright persistent profile for interactive lecture-capture login. */
export function getBrowserProfileDir(provider: string): string {
  return join(getHomeDir(), "browser-profiles", provider);
}

/**
 * Session cookies for a lecture-capture provider (Playwright storageState).
 * Mode 0600. Never contains passwords.
 */
export function getSessionPath(provider: string): string {
  return join(getHomeDir(), `${provider}-session.json`);
}

/** Directory for lazily installed optional tools (Playwright, tesseract.js). */
export function getToolsDir(): string {
  return join(getHomeDir(), "tools");
}
