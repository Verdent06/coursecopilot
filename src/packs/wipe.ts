import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { CourseRepo } from "../db/repo.js";
import { DB_FILENAME, getDbPath, getHomeDir } from "../util/paths.js";

/** Delete one course (and its sources, packs, topics, quizzes). */
export function wipeCourse(repo: CourseRepo, courseId: string): void {
  repo.deleteCourse(courseId);
}

/**
 * Delete the local SQLite file (and WAL/SHM). The caller must not have the
 * database open. Used by `coursecopilot wipe --yes`.
 */
export function wipeDatabaseFile(homeDir = getHomeDir()): { path: string; removed: boolean } {
  const dbPath = homeDir === getHomeDir() ? getDbPath() : join(homeDir, DB_FILENAME);
  let removed = false;
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(candidate)) {
      rmSync(candidate, { force: true });
      removed = true;
    }
  }
  return { path: dbPath, removed };
}
