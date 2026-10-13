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
