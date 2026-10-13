import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { log } from "../util/log.js";
import { getDbPath } from "../util/paths.js";

export const SCHEMA_VERSION = 3;
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
const nodeRequire = createRequire(import.meta.url);

export type OpenDatabaseOptions = {
  path?: string;
};

export type OpenedDatabase = {
  db: Database.Database;
  path: string;
  vecEnabled: boolean;
  vecHasCourseId: boolean;
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
  const vecHasCourseId = migrate(db, vecEnabled);
  return { db, path, vecEnabled, vecHasCourseId };
}

export function migrate(db: Database.Database, vecEnabled: boolean): boolean {
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  const [required] = sql.split("-- @optional sqlite-vec");
  if (!required) {
    throw new Error(`Empty schema at ${SCHEMA_PATH}`);
  }
  db.exec(required);
  const vecHasCourseId = vecEnabled ? ensureChunksVec(db) : false;
  migrateToV2(db);
  migrateToV3(db);
  const current = db.prepare("SELECT MAX(v) AS v FROM schema_version").get() as {
    v: number | null;
  };
  if (current.v == null || current.v < SCHEMA_VERSION) {
    db.prepare("INSERT INTO schema_version(v) VALUES (?)").run(SCHEMA_VERSION);
  }
  return vecHasCourseId;
}

/**
 * Create chunks_vec. M2 DBs that already have the spec table are kept.
 * Mid-M3 experiments with extra columns are rebuilt (no embeddings stored yet).
 */
function ensureChunksVec(db: Database.Database): boolean {
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chunks_vec'")
    .get() as { sql: string } | undefined;
  if (existing?.sql && /course_id|chunk_id/i.test(existing.sql)) {
    try {
      db.exec("DROP TABLE chunks_vec");
    } catch (err) {
      log.warn("could not drop legacy chunks_vec", err);
    }
  } else if (existing) {
    return false;
  }
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[384]);");
  } catch (err) {
    log.warn("failed to create chunks_vec virtual table", err);
  }
  return false;
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

/**
 * v3: allow sources.kind = 'leccap'. Fresh installs already have this CHECK
 * from schema.sql; existing files keep the old CHECK under IF NOT EXISTS.
 */
export function migrateToV3(db: Database.Database): void {
  const sourcesSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sources'").get() as
    | { sql: string }
    | undefined;
  if (sourcesSql?.sql && !sourcesSql.sql.includes("'leccap'")) {
    rebuildSourcesKind(db);
  }
}

function rebuildSourcesKind(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE sources_new(
      id TEXT PRIMARY KEY,
      course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
      kind TEXT CHECK(kind IN ('website','canvas','file','folder','youtube','transcript','leccap')),
      uri TEXT NOT NULL,
      title TEXT,
      config_json TEXT,
      status TEXT CHECK(status IN ('queued','running','done','error','partial')),
      error TEXT,
      last_synced_at TEXT
    );
    INSERT INTO sources_new(id, course_id, kind, uri, title, config_json, status, error, last_synced_at)
      SELECT id, course_id, kind, uri, title, config_json, status, error, last_synced_at FROM sources;
    DROP TABLE sources;
    ALTER TABLE sources_new RENAME TO sources;
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
