import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { log } from "../util/log.js";
import { getDbPath } from "../util/paths.js";

export const SCHEMA_VERSION = 2;
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
const nodeRequire = createRequire(import.meta.url);

export type OpenDatabaseOptions = {
  path?: string;
};

export type OpenedDatabase = {
  db: Database.Database;
  path: string;
  vecEnabled: boolean;
};

export function openDatabase(options: OpenDatabaseOptions = {}): OpenedDatabase {
  const path = options.path ?? getDbPath();
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const vecEnabled = loadSqliteVec(db);
  migrate(db, vecEnabled);
  return { db, path, vecEnabled };
}

export function migrate(db: Database.Database, vecEnabled: boolean): void {
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  const [required, optionalVec] = sql.split("-- @optional sqlite-vec");
  if (!required) {
    throw new Error(`Empty schema at ${SCHEMA_PATH}`);
  }
  db.exec(required);
  if (vecEnabled && optionalVec?.trim()) {
    try {
      db.exec(optionalVec);
    } catch (err) {
      log.warn("failed to create chunks_vec virtual table", err);
    }
  }
  migrateToV2(db);
  const current = db.prepare("SELECT MAX(v) AS v FROM schema_version").get() as {
    v: number | null;
  };
  if (current.v == null || current.v < SCHEMA_VERSION) {
    db.prepare("INSERT INTO schema_version(v) VALUES (?)").run(SCHEMA_VERSION);
  }
}

/**
 * Bring a v1 database up to M2: packs table, jobs.result_json, topics.origin 'pack'.
 * Fresh installs already get these from schema.sql; this path is for existing files.
 */
export function migrateToV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packs(
      id TEXT PRIMARY KEY,
      course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
      version TEXT,
      origin TEXT,
      manifest_json TEXT NOT NULL,
      installed_at TEXT
    );
  `);

  const jobCols = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  if (!jobCols.some((c) => c.name === "result_json")) {
    db.exec("ALTER TABLE jobs ADD COLUMN result_json TEXT");
  }

  const topicsSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'topics'").get() as
    | { sql: string }
    | undefined;
  if (topicsSql?.sql && !topicsSql.sql.includes("'pack'")) {
    rebuildTopicsOrigin(db);
  }
}

function rebuildTopicsOrigin(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE topics_new(
      id TEXT PRIMARY KEY,
      course_id TEXT,
      name TEXT,
      origin TEXT CHECK(origin IN ('heuristic','host','user','pack')),
      UNIQUE(course_id, name)
    );
    INSERT INTO topics_new(id, course_id, name, origin) SELECT id, course_id, name, origin FROM topics;
    DROP TABLE topics;
    ALTER TABLE topics_new RENAME TO topics;
    PRAGMA foreign_keys = ON;
  `);
}

export function isVecEnabled(db: Database.Database): boolean {
  try {
    db.prepare("SELECT vec_version() AS v").get();
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks_vec'")
      .get();
    return Boolean(row);
  } catch {
    return false;
  }
}

function loadSqliteVec(db: Database.Database): boolean {
  try {
    const sqliteVec = nodeRequire("sqlite-vec") as { load: (db: Database.Database) => void };
    sqliteVec.load(db);
    db.prepare("SELECT vec_version() AS v").get();
    return true;
  } catch (err) {
    log.warn("sqlite-vec failed to load; vector search will be unavailable", err);
    return false;
  }
}
