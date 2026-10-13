-- CourseCopilot SQLite schema (M2).
-- Applied by src/db/migrate.ts. Optional sqlite-vec DDL is split at the marker below.

CREATE TABLE IF NOT EXISTS courses(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  term TEXT,
  exam_dates_json TEXT DEFAULT '[]',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sources(
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
  kind TEXT CHECK(kind IN ('website','canvas','file','folder','youtube','transcript')),
  uri TEXT NOT NULL,
  title TEXT,
  config_json TEXT,
  status TEXT CHECK(status IN ('queued','running','done','error','partial')),
  error TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
  course_id TEXT,
  url TEXT,
  title TEXT,
  mime TEXT,
  content_hash TEXT,
  fetched_at TEXT,
  meta_json TEXT
);

CREATE TABLE IF NOT EXISTS chunks(
  id INTEGER PRIMARY KEY,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  course_id TEXT,
  ord INTEGER,
  text TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  heading_path TEXT,
  token_count INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  heading_path,
  content='chunks',
  content_rowid='id'
);

-- Keep the FTS5 external-content table in sync. The spec's content='chunks'
-- setup does not populate FTS on its own.
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, heading_path)
  VALUES (new.id, new.text, new.heading_path);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading_path)
  VALUES('delete', old.id, old.text, old.heading_path);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading_path)
  VALUES('delete', old.id, old.text, old.heading_path);
  INSERT INTO chunks_fts(rowid, text, heading_path)
  VALUES (new.id, new.text, new.heading_path);
END;

CREATE TABLE IF NOT EXISTS topics(
  id TEXT PRIMARY KEY,
  course_id TEXT,
  name TEXT,
  origin TEXT CHECK(origin IN ('heuristic','host','user','pack')),
  UNIQUE(course_id, name)
);
CREATE TABLE IF NOT EXISTS chunk_topics(
  chunk_id INTEGER,
  topic_id TEXT,
  weight REAL,
  PRIMARY KEY(chunk_id, topic_id)
);

CREATE TABLE IF NOT EXISTS quiz_attempts(
  id TEXT PRIMARY KEY,
  course_id TEXT,
  created_at TEXT,
  mode TEXT
);
CREATE TABLE IF NOT EXISTS quiz_items(
  id TEXT PRIMARY KEY,
  attempt_id TEXT REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  topic_id TEXT,
  question TEXT,
  user_answer TEXT,
  correct INTEGER CHECK(correct IN (0,1)),
  partial_credit REAL,
  difficulty INTEGER CHECK(difficulty BETWEEN 1 AND 3),
  confidence INTEGER,
  cited_chunk_ids TEXT
);

CREATE TABLE IF NOT EXISTS topic_mastery(
  course_id TEXT,
  topic_id TEXT,
  alpha REAL DEFAULT 1,
  beta REAL DEFAULT 1,
  last_seen_at TEXT,
  n_attempts INTEGER DEFAULT 0,
  PRIMARY KEY(course_id, topic_id)
);

CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY,
  source_id TEXT,
  state TEXT,
  progress REAL,
  message TEXT,
  started_at TEXT,
  finished_at TEXT,
  result_json TEXT
);

CREATE TABLE IF NOT EXISTS packs(
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
  version TEXT,
  origin TEXT,
  manifest_json TEXT NOT NULL,
  installed_at TEXT
);

CREATE TABLE IF NOT EXISTS schema_version(v INTEGER);

-- @optional sqlite-vec
-- rowid is chunks.id. Bind rowid as BigInt (better-sqlite3 numbers are
-- rejected by sqlite-vec as primary keys).
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[384]);
