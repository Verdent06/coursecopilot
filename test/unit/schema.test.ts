import { afterEach, describe, expect, it } from "vitest";
import { isVecEnabled } from "../../src/db/migrate.js";
import { openMemory } from "../helpers/memory-db.js";

const EXPECTED_TABLES = [
  "chunk_topics",
  "chunks",
  "chunks_fts",
  "courses",
  "documents",
  "jobs",
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

  it("creates the spec tables, FTS5, and schema_version = 1", () => {
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
    expect(version.v).toBe(1);

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
