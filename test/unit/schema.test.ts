import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { isVecEnabled, migrate } from "../../src/db/migrate.js";
import { openMemory } from "../helpers/memory-db.js";

const EXPECTED_TABLES = [
  "chunk_topics",
  "chunks",
  "chunks_fts",
  "courses",
  "documents",
  "jobs",
  "packs",
  "quiz_attempts",
  "quiz_items",
  "schema_version",
  "sources",
  "topic_mastery",
  "topics",
];

describe("schema migration", () => {
  let close: (() => void) | undefined;

  afterEach(() => {
    close?.();
    close = undefined;
  });

  it("creates the spec tables, FTS5, packs, and schema_version = 2", () => {
    const { opened } = openMemory();
    close = () => opened.db.close();

    const names = opened.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
      .all() as Array<{ name: string }>;
    const set = new Set(names.map((n) => n.name));

    for (const table of EXPECTED_TABLES) {
      expect(set.has(table), `missing table ${table}`).toBe(true);
    }

    const version = opened.db.prepare("SELECT MAX(v) AS v FROM schema_version").get() as {
      v: number;
    };
    expect(version.v).toBe(2);

    const fts = opened.db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'chunks_fts'")
      .get() as { sql: string };
    expect(fts.sql.toLowerCase()).toContain("fts5");
  });

  it("keeps FTS in sync via triggers", () => {
    const { opened } = openMemory();
    close = () => opened.db.close();
    const db = opened.db;

    db.exec(`
      INSERT INTO courses(id, title, created_at, updated_at) VALUES ('c1', 'T', 't', 't');
      INSERT INTO sources(id, course_id, kind, uri, status)
        VALUES ('s1', 'c1', 'file', 'file:///tmp/a.pdf', 'done');
      INSERT INTO documents(id, source_id, course_id, url, title)
        VALUES ('d1', 's1', 'c1', 'file:///tmp/a.pdf', 'Lecture 7');
      INSERT INTO chunks(document_id, course_id, ord, text, locator_json, heading_path, token_count)
        VALUES ('d1', 'c1', 0, 'the pumping lemma proof', '{"page":14}', 'Lecture 7', 4);
    `);

    const hits = db
      .prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'pumping'")
      .all() as Array<{ rowid: number }>;
    expect(hits.length).toBe(1);
  });

  it("accepts topics.origin = pack and stores a packs row", () => {
    const { opened } = openMemory();
    close = () => opened.db.close();
    const db = opened.db;
    db.exec(`
      INSERT INTO courses(id, title, created_at, updated_at) VALUES ('c1', 'T', 't', 't');
      INSERT INTO topics(id, course_id, name, origin) VALUES ('t1', 'c1', 'Pumping lemma', 'pack');
      INSERT INTO packs(id, course_id, version, origin, manifest_json, installed_at)
        VALUES ('mit-6.045-s11', 'c1', '1.0.0', 'path', '{"schema":1}', 't');
    `);
    const topic = db.prepare("SELECT origin FROM topics WHERE id = 't1'").get() as {
      origin: string;
    };
    expect(topic.origin).toBe("pack");
    const pack = db.prepare("SELECT id FROM packs").get() as { id: string };
    expect(pack.id).toBe("mit-6.045-s11");
  });

  it("migrates a v1 DB: topics.origin pack + jobs.result_json", () => {
    const db = new Database(":memory:");
    close = () => db.close();
    db.exec(`
      CREATE TABLE courses(
        id TEXT PRIMARY KEY, title TEXT, term TEXT, exam_dates_json TEXT,
        created_at TEXT, updated_at TEXT
      );
      CREATE TABLE topics(
        id TEXT PRIMARY KEY,
        course_id TEXT,
        name TEXT,
        origin TEXT CHECK(origin IN ('heuristic','host','user')),
        UNIQUE(course_id, name)
      );
      CREATE TABLE jobs(
        id TEXT PRIMARY KEY, source_id TEXT, state TEXT, progress REAL,
        message TEXT, started_at TEXT, finished_at TEXT
      );
      CREATE TABLE schema_version(v INTEGER);
      INSERT INTO schema_version(v) VALUES (1);
      INSERT INTO courses(id, title) VALUES ('c1', 'T');
      INSERT INTO topics(id, course_id, name, origin) VALUES ('t1', 'c1', 'A', 'heuristic');
    `);
    migrate(db, false);
    db.exec(`INSERT INTO topics(id, course_id, name, origin) VALUES ('t2', 'c1', 'B', 'pack')`);
    const cols = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "result_json")).toBe(true);
    const version = db.prepare("SELECT MAX(v) AS v FROM schema_version").get() as { v: number };
    expect(version.v).toBe(2);
    const packOk = db.prepare("SELECT origin FROM topics WHERE id = 't2'").get() as {
      origin: string;
    };
    expect(packOk.origin).toBe("pack");
  });

  it("loads sqlite-vec (or degrades cleanly)", () => {
    const { opened } = openMemory();
    close = () => opened.db.close();

    if (opened.vecEnabled) {
      expect(isVecEnabled(opened.db)).toBe(true);
      const ver = opened.db.prepare("SELECT vec_version() AS v").get() as { v: string };
      expect(ver.v).toBeTruthy();
    } else {
      expect(isVecEnabled(opened.db)).toBe(false);
    }
  });
});
