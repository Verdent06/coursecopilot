import { type OpenedDatabase, openDatabase } from "../../src/db/migrate.js";
import { CourseRepo } from "../../src/db/repo.js";

export function openMemory(): { opened: OpenedDatabase; repo: CourseRepo } {
  const opened = openDatabase({ path: ":memory:" });
  return { opened, repo: new CourseRepo(opened.db) };
}
