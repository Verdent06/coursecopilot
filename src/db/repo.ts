import type Database from "better-sqlite3";
import { isValidCourseId, nextAvailableSlug, slugifyCourseId } from "../util/ids.js";

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

  unknownCourseMessage(courseId: string): string {
    const ids = this.idList();
    if (!ids) {
      return `Unknown course_id "${courseId}". No courses yet. Call add_course first.`;
    }
    return `Unknown course_id "${courseId}". Valid ids: ${ids}`;
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

function nowIso(): string {
  return new Date().toISOString();
}
