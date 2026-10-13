import type Database from "better-sqlite3";
import { isValidCourseId, nextAvailableSlug, slugifyCourseId } from "../util/ids.js";
import { nowIso } from "../util/time.js";

export type Exam = {
  name: string;
  date: string;
  topics: string[];
  weight: number | null;
};

export type CourseRow = {
  course_id: string;
  title: string;
  term: string | null;
  source_count: number;
  chunk_count: number;
  exams: Exam[];
};

export type AddCourseInput = {
  title: string;
  term?: string;
  course_id?: string;
};

export type SetExamInput = {
  course_id: string;
  name: string;
  date: string;
  topics?: string[];
  weight?: number;
};

export type SourceKind = "website" | "canvas" | "file" | "folder" | "youtube" | "transcript";
export type SourceStatus = "queued" | "running" | "done" | "error" | "partial";
export type JobState = "queued" | "running" | "done" | "error" | "partial";

export type SourceRow = {
  id: string;
  course_id: string;
  kind: SourceKind;
  uri: string;
  title: string | null;
  config_json: string | null;
  status: SourceStatus;
  error: string | null;
  last_synced_at: string | null;
};

export type SourceListItem = {
  source_id: string;
  kind: SourceKind;
  uri: string;
  status: SourceStatus;
  last_synced_at: string | null;
  doc_count: number;
};

export type JobRow = {
  id: string;
  source_id: string;
  state: JobState;
  progress: number | null;
  message: string | null;
  started_at: string | null;
  finished_at: string | null;
  result_json: string | null;
};

export type IngestStatusRow = {
  job_id: string;
  source_id: string;
  state: JobState;
  progress: number;
  message: string;
  docs: number;
  chunks: number;
  skipped: Array<{ url: string; reason: string }>;
};

export type ChunkRow = {
  id: number;
  document_id: string;
  course_id: string;
  ord: number;
  text: string;
  locator_json: string;
  heading_path: string | null;
  token_count: number | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CourseRepo {
  constructor(private readonly db: Database.Database) {}

  addCourse(input: AddCourseInput): { course_id: string } {
    const title = input.title.trim();
    if (!title) {
      throw new RepoError("title is required");
    }
    const term = input.term?.trim() || null;
    const now = nowIso();

    let courseId: string;
    if (input.course_id) {
      courseId = input.course_id.trim().toLowerCase();
      if (!isValidCourseId(courseId)) {
        throw new RepoError(
          `Invalid course_id "${input.course_id}". Use a lowercase slug such as eecs376-f26.`,
        );
      }
      if (this.exists(courseId)) {
        throw new RepoError(`course_id "${courseId}" already exists. Valid ids: ${this.idList()}`);
      }
    } else {
      const base = slugifyCourseId(title, term ?? undefined);
      courseId = nextAvailableSlug(base, (id) => this.exists(id));
    }

    this.db
      .prepare(
        `INSERT INTO courses(id, title, term, exam_dates_json, created_at, updated_at)
         VALUES (?, ?, ?, '[]', ?, ?)`,
      )
      .run(courseId, title, term, now, now);

    return { course_id: courseId };
  }

  listCourses(): CourseRow[] {
    const rows = this.db
      .prepare(
        `SELECT
           c.id AS course_id,
           c.title AS title,
           c.term AS term,
           c.exam_dates_json AS exam_dates_json,
           (SELECT COUNT(*) FROM sources s WHERE s.course_id = c.id) AS source_count,
           (SELECT COUNT(*) FROM chunks k WHERE k.course_id = c.id) AS chunk_count
         FROM courses c
         ORDER BY c.created_at ASC, c.id ASC`,
      )
      .all() as Array<{
      course_id: string;
      title: string;
      term: string | null;
      exam_dates_json: string;
      source_count: number;
      chunk_count: number;
    }>;

    return rows.map((row) => ({
      course_id: row.course_id,
      title: row.title,
      term: row.term,
      source_count: row.source_count,
      chunk_count: row.chunk_count,
      exams: parseExams(row.exam_dates_json),
    }));
  }

  setExam(input: SetExamInput): { exams: Exam[] } {
    const course = this.getCourse(input.course_id);
    if (!course) {
      throw new RepoError(this.unknownCourseMessage(input.course_id));
    }
    const name = input.name.trim();
    if (!name) {
      throw new RepoError("name is required");
    }
    if (!ISO_DATE.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) {
      throw new RepoError(`Invalid date "${input.date}". Use YYYY-MM-DD.`);
    }
    if (input.weight != null && (input.weight < 0 || input.weight > 1)) {
      throw new RepoError("weight must be between 0 and 1");
    }

    const exam: Exam = {
      name,
      date: input.date,
      topics: input.topics ?? [],
      weight: input.weight ?? null,
    };

    const exams = parseExams(course.exam_dates_json);
    const idx = exams.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
    if (idx >= 0) {
      exams[idx] = exam;
    } else {
      exams.push(exam);
    }
    exams.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

    this.db
      .prepare("UPDATE courses SET exam_dates_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(exams), nowIso(), input.course_id);

    return { exams };
  }

  courseExists(id: string): boolean {
    return this.exists(id);
  }

  requireCourse(courseId: string): void {
    if (!this.exists(courseId)) {
      throw new RepoError(this.unknownCourseMessage(courseId));
    }
  }

  insertSource(input: {
    id: string;
    course_id: string;
    kind: SourceKind;
    uri: string;
    title?: string | null;
    config_json?: string | null;
    status?: SourceStatus;
  }): SourceRow {
    this.requireCourse(input.course_id);
    this.db
      .prepare(
        `INSERT INTO sources(id, course_id, kind, uri, title, config_json, status, error, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(
        input.id,
        input.course_id,
        input.kind,
        input.uri,
        input.title ?? null,
        input.config_json ?? null,
        input.status ?? "queued",
      );
    const row = this.getSource(input.id);
    if (!row) {
      throw new RepoError("failed to insert source");
    }
    return row;
  }

  getSource(id: string): SourceRow | undefined {
    return this.db
      .prepare(
        `SELECT id, course_id, kind, uri, title, config_json, status, error, last_synced_at
         FROM sources WHERE id = ?`,
      )
      .get(id) as SourceRow | undefined;
  }

  updateSource(
    id: string,
    patch: {
      status?: SourceStatus;
      error?: string | null;
      last_synced_at?: string | null;
      title?: string | null;
    },
  ): void {
    const current = this.getSource(id);
    if (!current) {
      return;
    }
    this.db
      .prepare(
        `UPDATE sources SET status = ?, error = ?, last_synced_at = ?, title = ? WHERE id = ?`,
      )
      .run(
        patch.status ?? current.status,
        patch.error === undefined ? current.error : patch.error,
        patch.last_synced_at === undefined ? current.last_synced_at : patch.last_synced_at,
        patch.title === undefined ? current.title : patch.title,
        id,
      );
  }

  listSources(courseId: string): SourceListItem[] {
    this.requireCourse(courseId);
    return this.db
      .prepare(
        `SELECT
           s.id AS source_id,
           s.kind AS kind,
           s.uri AS uri,
           s.status AS status,
           s.last_synced_at AS last_synced_at,
           (SELECT COUNT(*) FROM documents d WHERE d.source_id = s.id) AS doc_count
         FROM sources s
         WHERE s.course_id = ?
         ORDER BY s.id ASC`,
      )
      .all(courseId) as SourceListItem[];
  }

  removeSource(sourceId: string): { removed_chunks: number } {
    const source = this.getSource(sourceId);
    if (!source) {
      throw new RepoError(`Unknown source_id "${sourceId}"`);
    }
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE d.source_id = ?`,
      )
      .get(sourceId) as { n: number };
    const removed = countRow.n;
    this.db
      .prepare(
        `DELETE FROM chunk_topics WHERE chunk_id IN (
           SELECT c.id FROM chunks c
           JOIN documents d ON d.id = c.document_id
           WHERE d.source_id = ?
         )`,
      )
      .run(sourceId);
    this.db.prepare("DELETE FROM jobs WHERE source_id = ?").run(sourceId);
    this.db.prepare("DELETE FROM sources WHERE id = ?").run(sourceId);
    return { removed_chunks: removed };
  }

  insertJob(input: {
    id: string;
    source_id: string;
    state: JobState;
    progress: number;
    message: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO jobs(id, source_id, state, progress, message, started_at, finished_at, result_json)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .run(input.id, input.source_id, input.state, input.progress, input.message);
  }

  getJob(id: string): JobRow | undefined {
    return this.db
      .prepare(
        `SELECT id, source_id, state, progress, message, started_at, finished_at, result_json
         FROM jobs WHERE id = ?`,
      )
      .get(id) as JobRow | undefined;
  }

  updateJob(
    id: string,
    patch: {
      state?: JobState;
      progress?: number;
      message?: string;
      started_at?: string | null;
      finished_at?: string | null;
      result_json?: string | null;
    },
  ): void {
    const current = this.getJob(id);
    if (!current) {
      return;
    }
    this.db
      .prepare(
        `UPDATE jobs SET state = ?, progress = ?, message = ?, started_at = ?, finished_at = ?, result_json = ?
         WHERE id = ?`,
      )
      .run(
        patch.state ?? current.state,
        patch.progress ?? current.progress,
        patch.message ?? current.message,
        patch.started_at === undefined ? current.started_at : patch.started_at,
        patch.finished_at === undefined ? current.finished_at : patch.finished_at,
        patch.result_json === undefined ? current.result_json : patch.result_json,
        id,
      );
  }

  listIngestStatus(filter: { job_id?: string; course_id?: string }): IngestStatusRow[] {
    if (filter.course_id) {
      this.requireCourse(filter.course_id);
    }
    if (filter.job_id) {
      const job = this.getJob(filter.job_id);
      if (!job) {
        throw new RepoError(`Unknown job_id "${filter.job_id}"`);
      }
      if (filter.course_id) {
        const source = this.getSource(job.source_id);
        if (!source || source.course_id !== filter.course_id) {
          return [];
        }
      }
      return [this.jobToStatus(job)];
    }
    const rows = filter.course_id
      ? (this.db
          .prepare(
            `SELECT j.id, j.source_id, j.state, j.progress, j.message, j.started_at, j.finished_at, j.result_json
             FROM jobs j
             JOIN sources s ON s.id = j.source_id
             WHERE s.course_id = ?
             ORDER BY j.id ASC`,
          )
          .all(filter.course_id) as JobRow[])
      : (this.db
          .prepare(
            `SELECT id, source_id, state, progress, message, started_at, finished_at, result_json
             FROM jobs ORDER BY id ASC`,
          )
          .all() as JobRow[]);
    return rows.map((row) => this.jobToStatus(row));
  }

  insertDocument(input: {
    id: string;
    source_id: string;
    course_id: string;
    url: string | null;
    title: string | null;
    mime: string | null;
    content_hash: string | null;
    fetched_at: string | null;
    meta_json: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO documents(id, source_id, course_id, url, title, mime, content_hash, fetched_at, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.source_id,
        input.course_id,
        input.url,
        input.title,
        input.mime,
        input.content_hash,
        input.fetched_at,
        input.meta_json,
      );
  }

  insertChunks(
    chunks: Array<{
      document_id: string;
      course_id: string;
      ord: number;
      text: string;
      locator_json: string;
      heading_path: string | null;
      token_count: number | null;
    }>,
  ): void {
    const stmt = this.db.prepare(
      `INSERT INTO chunks(document_id, course_id, ord, text, locator_json, heading_path, token_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const runMany = this.db.transaction((rows: typeof chunks) => {
      for (const row of rows) {
        stmt.run(
          row.document_id,
          row.course_id,
          row.ord,
          row.text,
          row.locator_json,
          row.heading_path,
          row.token_count,
        );
      }
    });
    runMany(chunks);
  }

  countDocuments(sourceId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM documents WHERE source_id = ?")
      .get(sourceId) as { n: number };
    return row.n;
  }

  countChunksForSource(sourceId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE d.source_id = ?`,
      )
      .get(sourceId) as { n: number };
    return row.n;
  }

  listChunksForCourse(courseId: string): ChunkRow[] {
    return this.db
      .prepare(
        `SELECT id, document_id, course_id, ord, text, locator_json, heading_path, token_count
         FROM chunks WHERE course_id = ? ORDER BY document_id ASC, ord ASC`,
      )
      .all(courseId) as ChunkRow[];
  }

  unknownCourseMessage(courseId: string): string {
    const ids = this.idList();
    if (!ids) {
      return `Unknown course_id "${courseId}". No courses yet. Call add_course first.`;
    }
    return `Unknown course_id "${courseId}". Valid ids: ${ids}`;
  }

  private jobToStatus(job: JobRow): IngestStatusRow {
    const parsed = parseJobResult(job.result_json);
    const docs = parsed.docs ?? this.countDocuments(job.source_id);
    const chunks = parsed.chunks ?? this.countChunksForSource(job.source_id);
    return {
      job_id: job.id,
      source_id: job.source_id,
      state: job.state,
      progress: job.progress ?? 0,
      message: job.message ?? "",
      docs,
      chunks,
      skipped: parsed.skipped,
    };
  }

  private getCourse(id: string): { exam_dates_json: string } | undefined {
    return this.db.prepare("SELECT exam_dates_json FROM courses WHERE id = ?").get(id) as
      | { exam_dates_json: string }
      | undefined;
  }

  private exists(id: string): boolean {
    const row = this.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").get(id);
    return Boolean(row);
  }

  private idList(): string {
    return this.listCourses()
      .map((c) => c.course_id)
      .join(", ");
  }
}

export class RepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoError";
  }
}

function parseExams(raw: string): Exam[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => {
      const rec = item as Record<string, unknown>;
      return {
        name: String(rec.name ?? ""),
        date: String(rec.date ?? ""),
        topics: Array.isArray(rec.topics) ? rec.topics.map(String) : [],
        weight: typeof rec.weight === "number" ? rec.weight : null,
      };
    });
  } catch {
    return [];
  }
}

function parseJobResult(raw: string | null): {
  docs?: number;
  chunks?: number;
  skipped: Array<{ url: string; reason: string }>;
} {
  if (!raw) {
    return { skipped: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const skippedRaw = Array.isArray(parsed.skipped) ? parsed.skipped : [];
    const skipped = skippedRaw.map((item) => {
      const rec = item as Record<string, unknown>;
      return { url: String(rec.url ?? ""), reason: String(rec.reason ?? "") };
    });
    return {
      docs: typeof parsed.docs === "number" ? parsed.docs : undefined,
      chunks: typeof parsed.chunks === "number" ? parsed.chunks : undefined,
      skipped,
    };
  } catch {
    return { skipped: [] };
  }
}
