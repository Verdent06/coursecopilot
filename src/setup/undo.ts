import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHomeDir } from "../util/paths.js";

export const UNDO_FILENAME = "setup-undo.json";
const MAX_SESSIONS = 10;

export type UndoFile = {
  path: string;
  /** Copy of the previous file. Null if setup created the file. */
  backup: string | null;
};

export type UndoSession = {
  at: string;
  files: UndoFile[];
};

export type UndoLog = {
  sessions: UndoSession[];
};

export function undoLogPath(homeDir = getHomeDir()): string {
  return join(homeDir, UNDO_FILENAME);
}

export function recordUndoSession(session: UndoSession, homeDir = getHomeDir()): void {
  const log = readUndoLog(homeDir);
  log.sessions.push(session);
  if (log.sessions.length > MAX_SESSIONS) {
    log.sessions = log.sessions.slice(-MAX_SESSIONS);
  }
  writeFileSync(undoLogPath(homeDir), `${JSON.stringify(log, null, 2)}\n`, "utf8");
}

export function readUndoLog(homeDir = getHomeDir()): UndoLog {
  const path = undoLogPath(homeDir);
  if (!existsSync(path)) {
    return { sessions: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as UndoLog;
    if (!parsed || !Array.isArray(parsed.sessions)) {
      return { sessions: [] };
    }
    return parsed;
  } catch {
    return { sessions: [] };
  }
}

export type UndoResult =
  | { ok: true; restored: string[]; removed: string[] }
  | { ok: false; message: string };

export function undoLastSetup(homeDir = getHomeDir()): UndoResult {
  const log = readUndoLog(homeDir);
  const session = log.sessions.pop();
  if (!session) {
    return { ok: false, message: "No setup backups to restore. Run `coursecopilot setup` first." };
  }
  const restored: string[] = [];
  const removed: string[] = [];
  for (const file of [...session.files].reverse()) {
    if (file.backup && existsSync(file.backup)) {
      copyFileSync(file.backup, file.path);
      restored.push(file.path);
    } else if (!file.backup && existsSync(file.path)) {
      rmSync(file.path);
      removed.push(file.path);
    }
  }
  writeFileSync(undoLogPath(homeDir), `${JSON.stringify(log, null, 2)}\n`, "utf8");
  return { ok: true, restored, removed };
}
