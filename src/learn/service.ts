import {
  type CourseRepo,
  type Exam,
  RepoError,
  type TopicOrigin,
  type TopicRow,
} from "../db/repo.js";
import type { Embedder } from "../ingest/embed.js";
import { extractAndAssignTopics } from "../ingest/topics.js";
import { type Citation, citationFromChunkRow } from "../retrieve/citation.js";
import type { HybridSearch } from "../retrieve/hybrid.js";
import { newId } from "../util/ids.js";
import {
  DEFAULT_QUIZ_N,
  DEFAULT_WEAK_LIMIT,
  MAX_QUIZ_N,
  QUIZ_INSTRUCTIONS_VERSION,
  quizInstructions,
  SUGGESTED_CHUNKS,
} from "./config.js";
import {
  applyQuizItem,
  emptyMastery,
  type MasteryState,
  readMastery,
  round4,
  weaknessScore,
} from "./mastery.js";
import { buildStudyPlan, type StudyPlan, utcDateString } from "./planner.js";

export type QuizFocus = "weak" | "all" | "exam";

export type QuizContextItem = {
  topic: string;
  chunks: Array<{ chunk_id: number; text: string; citation: Citation }>;
};

export type QuizContext = {
  items: QuizContextItem[];
  instructions: string;
  instructions_version: number;
};

export type WeakSpot = {
  topic: string;
  mastery: number;
  uncertainty: number;
  n_attempts: number;
  last_seen_days: number | null;
  suggested_chunks: Citation[];
};

export type MasteryDelta = {
  topic: string;
  before: number;
  after: number;
};

export type RecordQuizInput = {
  course_id?: string;
  mode?: string;
  items: Array<{
    topic: string;
    question: string;
    user_answer: string;
    correct: boolean | number;
    partial_credit?: number;
    difficulty?: number;
    confidence?: number;
    cited_chunk_ids?: number[];
  }>;
};

export type CourseOutline = {
  course_id: string;
  title: string;
  sources: Array<{
    source_id: string;
    kind: string;
    uri: string;
    documents: Array<{
      document_id: string;
      title: string;
      lecture_no: number | null;
      chunk_count: number;
    }>;
  }>;
  lectures: Array<{ lecture_no: number; title: string; document_ids: string[] }>;
  topics: Array<{ topic_id: string; name: string; origin: TopicOrigin; chunk_count: number }>;
};

export class LearnService {
  constructor(
    private readonly repo: CourseRepo,
    private readonly search: HybridSearch,
    private readonly embedder: Embedder | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureTopics(courseId: string): Promise<TopicRow[]> {
    const existing = this.repo.listTopics(courseId);
    if (existing.length > 0) {
      return existing;
    }
    return extractAndAssignTopics(this.repo, courseId, this.embedder);
  }

  async setTopics(input: {
    course_id: string;
    topics: Array<{ name: string; chunk_ids?: number[]; keywords?: string[] }>;
  }): Promise<{ topic_ids: string[] }> {
    const courseId = this.repo.resolveCourseId(input.course_id);
    const ids: string[] = [];
    for (const spec of input.topics) {
      const name = spec.name.trim();
      if (!name) {
        throw new RepoError("topic name is required");
      }
      const topic = this.repo.upsertTopic({
        id: `t_${newId()}`,
        course_id: courseId,
        name,
        origin: "host",
      });
      const assignments: Array<{ chunk_id: number; weight: number }> = [];
      for (const chunkId of spec.chunk_ids ?? []) {
        this.repo.requireChunkInCourse(chunkId, courseId);
        assignments.push({ chunk_id: chunkId, weight: 1 });
      }
      if (spec.keywords && spec.keywords.length > 0) {
        for (const chunk of this.repo.findChunksMatchingKeywords(courseId, spec.keywords)) {
          assignments.push({ chunk_id: chunk.id, weight: 0.8 });
        }
      }
      if (spec.chunk_ids && spec.chunk_ids.length > 0) {
        this.repo.replaceChunkTopics(topic.id, uniqueAssignments(assignments));
      } else if (assignments.length > 0) {
        this.repo.addChunkTopics(topic.id, uniqueAssignments(assignments));
      }
      ids.push(topic.id);
    }
    return { topic_ids: ids };
  }

  async getOutline(courseId?: string): Promise<CourseOutline> {
    const id = this.repo.resolveCourseId(courseId);
    const course = this.repo.getCourseInfo(id);
    if (!course) {
      throw new RepoError(this.repo.unknownCourseMessage(id));
    }
    await this.ensureTopics(id);
    const sources = this.repo.listSources(id);
    const docs = this.repo.listDocumentsForCourse(id);
    const sourceDocs = new Map<string, CourseOutline["sources"][number]["documents"]>();
    const lecturesMap = new Map<number, { title: string; document_ids: string[] }>();
    for (const doc of docs) {
      const lectureNo = lectureNumber(doc.title, doc.meta_json);
      const item = {
        document_id: doc.id,
        title: doc.title ?? doc.id,
        lecture_no: lectureNo,
        chunk_count: doc.chunk_count,
      };
      const list = sourceDocs.get(doc.source_id) ?? [];
      list.push(item);
      sourceDocs.set(doc.source_id, list);
      if (lectureNo != null) {
        const lec = lecturesMap.get(lectureNo) ?? { title: item.title, document_ids: [] };
        if (!lec.document_ids.includes(doc.id)) {
          lec.document_ids.push(doc.id);
        }
        lecturesMap.set(lectureNo, lec);
      }
    }
    const lectures = [...lecturesMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([lecture_no, v]) => ({ lecture_no, title: v.title, document_ids: v.document_ids }));
    return {
      course_id: id,
      title: course.title,
      sources: sources.map((s) => ({
        source_id: s.source_id,
        kind: s.kind,
        uri: s.uri,
        documents: sourceDocs.get(s.source_id) ?? [],
      })),
      lectures,
      topics: this.repo.listTopics(id).map((t) => ({
        topic_id: t.id,
        name: t.name,
        origin: t.origin,
        chunk_count: t.chunk_count,
      })),
    };
  }

  async generateQuizContext(input: {
    course_id?: string;
    topics?: string[];
    n?: number;
    difficulty?: number;
    focus?: QuizFocus;
    exam_name?: string;
  }): Promise<QuizContext> {
    const courseId = this.repo.resolveCourseId(input.course_id);
    const n = clampN(input.n);
    await this.ensureTopics(courseId);
    const ranked = await this.rankTopics(courseId, input.exam_name);
    if (ranked.length === 0 && this.repo.listChunksForCourse(courseId).length === 0) {
      throw new RepoError("No indexed chunks. Add a source first.");
    }
    let selected = ranked;
    const focus = input.focus ?? "all";
    if (input.topics && input.topics.length > 0) {
      const want = new Set(input.topics.map((t) => t.trim().toLowerCase()));
      selected = ranked.filter((t) => want.has(t.name.toLowerCase()));
      if (selected.length === 0) {
        throw new RepoError(
          `None of the requested topics exist. Known topics: ${ranked.map((t) => t.name).join(", ") || "(none)"}`,
        );
      }
    } else if (focus === "weak") {
      selected = ranked.slice(0, Math.max(1, Math.min(n, ranked.length)));
    } else if (focus === "exam") {
      const exam = this.resolveExam(courseId, input.exam_name);
      if (!exam) {
        throw new RepoError("No exam set. Call set_exam first, or use focus 'all' or 'weak'.");
      }
      const listed = new Set(exam.topics.map((t) => t.toLowerCase()));
      selected = listed.size > 0 ? ranked.filter((t) => listed.has(t.name.toLowerCase())) : ranked;
      if (selected.length === 0) {
        selected = ranked;
      }
    }
    if (selected.length === 0) {
      selected = ranked;
    }
    if (selected.length === 0) {
      throw new RepoError("No topics yet. Call set_topics or ingest sources first.");
    }

    const items: QuizContextItem[] = [];
    const used = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const topic = selected[i % selected.length];
      if (!topic) {
        break;
      }
      const offset = used.get(topic.name) ?? 0;
      used.set(topic.name, offset + SUGGESTED_CHUNKS);
      const chunks = topic.chunks.slice(offset, offset + SUGGESTED_CHUNKS);
      const fallback = chunks.length > 0 ? chunks : topic.chunks.slice(0, SUGGESTED_CHUNKS);
      items.push({
        topic: topic.name,
        chunks: fallback.map((c) => ({
          chunk_id: c.citation.chunk_id,
          text: c.text,
          citation: c.citation,
        })),
      });
    }
    return {
      items,
      instructions: quizInstructions(n, input.difficulty),
      instructions_version: QUIZ_INSTRUCTIONS_VERSION,
    };
  }

  recordQuizAttempt(input: RecordQuizInput): { attempt_id: string; mastery_delta: MasteryDelta[] } {
    const courseId = this.repo.resolveCourseId(input.course_id);
    if (input.items.length === 0) {
      throw new RepoError("items must contain at least one quiz result");
    }
    const now = this.now();
    const attemptId = `qa_${newId()}`;
    const mode = input.mode?.trim() || "quiz";
    const deltas = new Map<string, MasteryDelta & { topic_id: string }>();

    this.repo.runInTransaction(() => {
      this.repo.insertQuizAttempt({
        id: attemptId,
        course_id: courseId,
        created_at: now.toISOString(),
        mode,
      });
      for (const item of input.items) {
        const topicName = item.topic.trim();
        if (!topicName) {
          throw new RepoError("each item needs a topic");
        }
        const topic = this.repo.upsertTopic({
          id: `t_${newId()}`,
          course_id: courseId,
          name: topicName,
          origin: "host",
        });
        const beforeState = this.masteryState(courseId, topic.id);
        const beforeRead = readMastery(beforeState, now);
        const afterState = applyQuizItem(
          beforeState,
          {
            correct: coerceCorrect(item.correct),
            partial_credit: item.partial_credit,
            difficulty: item.difficulty,
            confidence: item.confidence,
          },
          now,
        );
        this.repo.upsertMastery({
          course_id: courseId,
          topic_id: topic.id,
          alpha: afterState.alpha,
          beta: afterState.beta,
          last_seen_at: afterState.last_seen_at,
          n_attempts: afterState.n_attempts,
        });
        const afterRead = readMastery(afterState, now);
        const prev = deltas.get(topic.id);
        deltas.set(topic.id, {
          topic: topic.name,
          topic_id: topic.id,
          before: prev?.before ?? round4(beforeRead.mastery),
          after: round4(afterRead.mastery),
        });
        this.repo.insertQuizItem({
          id: `qi_${newId()}`,
          attempt_id: attemptId,
          topic_id: topic.id,
          question: item.question,
          user_answer: item.user_answer,
          correct: coerceCorrect(item.correct) ? 1 : 0,
          partial_credit: item.partial_credit ?? null,
          difficulty: item.difficulty ?? null,
          confidence: item.confidence ?? null,
          cited_chunk_ids: item.cited_chunk_ids ? JSON.stringify(item.cited_chunk_ids) : null,
        });
      }
    });

    return {
      attempt_id: attemptId,
      mastery_delta: [...deltas.values()].map(({ topic, before, after }) => ({
        topic,
        before,
        after,
      })),
    };
  }

  async getWeakSpots(
    courseId?: string,
    limit = DEFAULT_WEAK_LIMIT,
  ): Promise<{ spots: WeakSpot[] }> {
    const id = this.repo.resolveCourseId(courseId);
    await this.ensureTopics(id);
    const ranked = await this.rankTopics(id);
    const n = Math.max(1, Math.min(50, Math.floor(limit)));
    return {
      spots: ranked.slice(0, n).map((t) => ({
        topic: t.name,
        mastery: round4(t.mastery),
        uncertainty: round4(t.uncertainty),
        n_attempts: t.n_attempts,
        last_seen_days: t.last_seen_days == null ? null : round4(t.last_seen_days),
        suggested_chunks: t.chunks.map((c) => c.citation).slice(0, SUGGESTED_CHUNKS),
      })),
    };
  }

  async getStudyPlan(input: {
    course_id?: string;
    exam_name?: string;
    days?: number;
    minutes_per_day?: number;
  }): Promise<StudyPlan> {
    const courseId = this.repo.resolveCourseId(input.course_id);
    await this.ensureTopics(courseId);
    const exam = this.resolveExam(courseId, input.exam_name);
    const ranked = await this.rankTopics(courseId, exam?.name);
    const plan = buildStudyPlan({
      topics: ranked.map((t) => ({
        name: t.name,
        weakness: t.weakness,
        chunks: t.chunks.map((c) => c.citation).slice(0, SUGGESTED_CHUNKS),
      })),
      examName: exam?.name,
      examDate: exam?.date,
      days: input.days,
      minutesPerDay: input.minutes_per_day ?? 60,
      now: this.now(),
    });
    return plan;
  }

  listMasteryResource(courseId: string): {
    course_id: string;
    topics: Array<{
      topic: string;
      mastery: number;
      uncertainty: number;
      n_attempts: number;
      last_seen_days: number | null;
    }>;
  } {
    const id = this.repo.resolveCourseId(courseId);
    const now = this.now();
    const topics = this.repo.listTopics(id);
    const rows = topics.map((topic) => {
      const read = readMastery(this.masteryState(id, topic.id), now);
      return {
        topic: topic.name,
        mastery: round4(read.mastery),
        uncertainty: round4(read.uncertainty),
        n_attempts: read.n_attempts,
        last_seen_days: read.last_seen_days == null ? null : round4(read.last_seen_days),
      };
    });
    rows.sort((a, b) => a.mastery - b.mastery || a.topic.localeCompare(b.topic));
    return { course_id: id, topics: rows };
  }

  private masteryState(courseId: string, topicId: string): MasteryState {
    const row = this.repo.getMastery(courseId, topicId);
    if (!row) {
      return emptyMastery();
    }
    return {
      alpha: row.alpha,
      beta: row.beta,
      n_attempts: row.n_attempts,
      last_seen_at: row.last_seen_at,
    };
  }

  private resolveExam(courseId: string, examName?: string): Exam | undefined {
    const course = this.repo.getCourseInfo(courseId);
    const exams = course?.exams ?? [];
    if (examName) {
      const found = exams.find((e) => e.name.toLowerCase() === examName.trim().toLowerCase());
      if (!found) {
        const names = exams.map((e) => e.name).join(", ");
        throw new RepoError(
          `Unknown exam "${examName}".${names ? ` Valid names: ${names}` : " Call set_exam first."}`,
        );
      }
      return found;
    }
    const today = utcDateString(this.now());
    const upcoming = exams
      .filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] ?? exams[exams.length - 1];
  }

  private async rankTopics(
    courseId: string,
    examName?: string,
  ): Promise<
    Array<{
      name: string;
      topic_id: string;
      weakness: number;
      mastery: number;
      uncertainty: number;
      n_attempts: number;
      last_seen_days: number | null;
      chunks: Array<{ text: string; citation: Citation }>;
    }>
  > {
    const topics = this.repo.listTopics(courseId);
    const exam = this.safeExam(courseId, examName);
    const listed = new Set((exam?.topics ?? []).map((t) => t.toLowerCase()));
    const now = this.now();
    const out = [];
    for (const topic of topics) {
      const read = readMastery(this.masteryState(courseId, topic.id), now);
      const chunks = await this.suggestedChunks(courseId, topic);
      out.push({
        name: topic.name,
        topic_id: topic.id,
        weakness: weaknessScore({
          alpha: read.alpha,
          beta: read.beta,
          n_attempts: read.n_attempts,
          examListed: listed.has(topic.name.toLowerCase()),
        }),
        mastery: read.mastery,
        uncertainty: read.uncertainty,
        n_attempts: read.n_attempts,
        last_seen_days: read.last_seen_days,
        chunks,
      });
    }
    out.sort((a, b) => b.weakness - a.weakness || a.name.localeCompare(b.name));
    return out;
  }

  private safeExam(courseId: string, examName?: string): Exam | undefined {
    try {
      return this.resolveExam(courseId, examName);
    } catch {
      return undefined;
    }
  }

  private async suggestedChunks(
    courseId: string,
    topic: TopicRow,
  ): Promise<Array<{ text: string; citation: Citation }>> {
    const linked = this.repo.listChunksForTopic(topic.id);
    if (linked.length > 0) {
      return linked.slice(0, SUGGESTED_CHUNKS * 4).map((row) => ({
        text: row.text,
        citation: citationFromChunkRow(row),
      }));
    }
    try {
      const result = await this.search.search({
        query: topic.name,
        course_id: courseId,
        k: SUGGESTED_CHUNKS * 2,
        topic: topic.name,
      });
      return result.results.map((r) => ({ text: r.text, citation: r.citation }));
    } catch {
      const matches = this.repo.findChunksMatchingKeywords(courseId, [topic.name]);
      return matches.slice(0, SUGGESTED_CHUNKS).map((row) => ({
        text: row.text,
        citation: citationFromChunkRow(row),
      }));
    }
  }
}

function uniqueAssignments(
  assignments: Array<{ chunk_id: number; weight: number }>,
): Array<{ chunk_id: number; weight: number }> {
  const best = new Map<number, number>();
  for (const a of assignments) {
    const prev = best.get(a.chunk_id);
    if (prev == null || a.weight > prev) {
      best.set(a.chunk_id, a.weight);
    }
  }
  return [...best.entries()].map(([chunk_id, weight]) => ({ chunk_id, weight }));
}

function coerceCorrect(value: boolean | number): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return value === 1;
}

function clampN(n: number | undefined): number {
  if (n == null || Number.isNaN(n)) {
    return DEFAULT_QUIZ_N;
  }
  return Math.min(MAX_QUIZ_N, Math.max(1, Math.floor(n)));
}

function lectureNumber(title: string | null, metaJson: string | null): number | null {
  if (metaJson) {
    try {
      const meta = JSON.parse(metaJson) as { lecture_no?: unknown };
      if (typeof meta.lecture_no === "number") {
        return meta.lecture_no;
      }
    } catch {
      // ignore
    }
  }
  const m = /lecture\s+(\d+)/i.exec(title ?? "");
  return m?.[1] ? Number(m[1]) : null;
}
