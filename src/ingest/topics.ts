import type { CourseRepo, TopicRow } from "../db/repo.js";
import { parseMeta } from "../retrieve/citation.js";
import { newId } from "../util/ids.js";
import { log } from "../util/log.js";
import { TOPIC_ASSIGN_COSINE, TOPIC_DEDUP_COSINE } from "./config.js";
import type { Embedder } from "./embed.js";
import { hashEmbed } from "./embed.js";
import type { Locator } from "./types.js";

const GENERIC_TOPIC =
  /^(page|slide|notes?|homework|syllabus|contents|index|untitled|document|office[- ]hours)(\s+\d+)?$/i;

const FILE_NAME = /\.(md|txt|pdf|pptx|docx)$/i;

export function normalizeTopicName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function isGenericTopicName(name: string, courseTitle?: string | null): boolean {
  const n = normalizeTopicName(name);
  if (n.length < 4 && !/^[A-Z0-9]{2,6}$/.test(n)) {
    return true;
  }
  if (GENERIC_TOPIC.test(n) || FILE_NAME.test(n)) {
    return true;
  }
  if (courseTitle && n.toLowerCase() === courseTitle.trim().toLowerCase()) {
    return true;
  }
  return false;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return s;
}

function meanVec(vectors: Float32Array[]): Float32Array {
  const dim = vectors[0]?.length ?? 0;
  const out = new Float32Array(dim);
  if (vectors.length === 0 || dim === 0) {
    return out;
  }
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      out[i] = (out[i] ?? 0) + (v[i] ?? 0);
    }
  }
  const inv = 1 / vectors.length;
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const x = (out[i] ?? 0) * inv;
    out[i] = x;
    norm += x * x;
  }
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 1;
  for (let i = 0; i < dim; i++) {
    out[i] = (out[i] ?? 0) * scale;
  }
  return out;
}

function parseLocator(raw: string): Locator {
  try {
    const parsed = JSON.parse(raw) as Locator;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function candidateNames(input: {
  docTitle: string | null;
  headingPath: string | null;
  locatorTitle?: string;
  lectureNo?: number;
}): string[] {
  const names: string[] = [];
  if (input.docTitle) {
    names.push(input.docTitle);
    const colon = input.docTitle.split(":").slice(1).join(":").trim();
    if (colon) {
      names.push(colon);
    }
  }
  if (input.locatorTitle) {
    names.push(input.locatorTitle);
  }
  if (input.headingPath) {
    for (const part of input.headingPath.split(">")) {
      names.push(part.trim());
    }
  }
  if (input.lectureNo != null) {
    names.push(`Lecture ${input.lectureNo}`);
  }
  return names;
}

/**
 * Heuristic topics from titles + heading_path (spec §9.6). Dedupes by embedding
 * cosine > 0.85 when an embedder is available, else by normalized name. Assigns
 * unlabeled chunks by heading match, then nearest topic centroid (cosine > 0.4).
 * Does not overwrite host/user/pack topics.
 */
export async function extractAndAssignTopics(
  repo: CourseRepo,
  courseId: string,
  embedder: Embedder | null,
): Promise<TopicRow[]> {
  const course = repo.getCourseInfo(courseId);
  if (!course) {
    return [];
  }
  const chunks = repo.listChunksForCourse(courseId);
  if (chunks.length === 0) {
    return repo.listTopics(courseId);
  }
  const docs = repo.listDocumentsForCourse(courseId);
  const docById = new Map(docs.map((d) => [d.id, d]));

  const raw: string[] = [];
  for (const doc of docs) {
    const meta = parseMeta(doc.meta_json);
    const lectureNo = typeof meta.lecture_no === "number" ? meta.lecture_no : undefined;
    raw.push(
      ...candidateNames({
        docTitle: doc.title,
        headingPath: null,
        lectureNo,
      }),
    );
  }
  for (const chunk of chunks) {
    const loc = parseLocator(chunk.locator_json);
    raw.push(
      ...candidateNames({
        docTitle: docById.get(chunk.document_id)?.title ?? null,
        headingPath: chunk.heading_path,
        locatorTitle: loc.title,
      }),
    );
  }

  const unique = new Map<string, string>();
  for (const name of raw) {
    const normalized = normalizeTopicName(name);
    if (!normalized || isGenericTopicName(normalized, course.title)) {
      continue;
    }
    const key = normalized.toLowerCase();
    const prev = unique.get(key);
    if (!prev || normalized.length > prev.length) {
      unique.set(key, normalized);
    }
  }

  let names = [...unique.values()];
  const canEmbed = Boolean(embedder && !embedder.degraded && (await embedder.ready()));
  if (canEmbed && embedder && names.length > 1) {
    try {
      const vectors = await embedder.embed(names);
      if (vectors) {
        names = dedupeByCosine(names, vectors, TOPIC_DEDUP_COSINE);
      }
    } catch (err) {
      log.warn("topic dedupe embeddings failed; using name equality", err);
    }
  }

  const topics: TopicRow[] = [];
  for (const name of names) {
    const topic = repo.upsertTopic({
      id: `t_${newId()}`,
      course_id: courseId,
      name,
      origin: "heuristic",
    });
    topics.push(topic);
  }

  const existing = repo.listTopics(courseId);
  const byName = existing.map((t) => ({ topic: t, key: t.name.toLowerCase() }));

  const unlabeled = chunks.filter((c) => !repo.chunkHasAnyTopic(c.id));
  const assigned = new Set<number>();

  for (const chunk of unlabeled) {
    const hay = `${chunk.heading_path ?? ""}\n${chunk.text}`.toLowerCase();
    const loc = parseLocator(chunk.locator_json);
    const locTitle = (loc.title ?? "").toLowerCase();
    for (const item of byName) {
      if (item.key.length < 4) {
        continue;
      }
      if (hay.includes(item.key) || locTitle.includes(item.key)) {
        repo.addChunkTopics(item.topic.id, [{ chunk_id: chunk.id, weight: 1 }]);
        assigned.add(chunk.id);
        break;
      }
    }
  }

  const leftover = unlabeled.filter((c) => !assigned.has(c.id));
  if (leftover.length === 0 || !canEmbed || !embedder) {
    return repo.listTopics(courseId);
  }

  try {
    await assignByCentroid(repo, embedder, existing, leftover);
  } catch (err) {
    log.warn("topic centroid assignment failed", err);
  }
  return repo.listTopics(courseId);
}

function dedupeByCosine(names: string[], vectors: Float32Array[], threshold: number): string[] {
  const keep: number[] = [];
  for (let i = 0; i < names.length; i++) {
    const vi = vectors[i];
    if (!vi) {
      keep.push(i);
      continue;
    }
    let dupOf = -1;
    for (const j of keep) {
      const vj = vectors[j];
      if (vj && cosine(vi, vj) >= threshold) {
        dupOf = j;
        break;
      }
    }
    if (dupOf < 0) {
      keep.push(i);
      continue;
    }
    const a = names[i] ?? "";
    const b = names[dupOf] ?? "";
    if (a.length > b.length) {
      const idx = keep.indexOf(dupOf);
      if (idx >= 0) {
        keep[idx] = i;
      }
    }
  }
  return keep.map((i) => names[i]).filter((n): n is string => Boolean(n));
}

async function assignByCentroid(
  repo: CourseRepo,
  embedder: Embedder,
  topics: TopicRow[],
  leftover: Array<{ id: number; text: string }>,
): Promise<void> {
  const centroids: Array<{ topic: TopicRow; vec: Float32Array }> = [];
  for (const topic of topics) {
    const linked = repo.listChunksForTopic(topic.id);
    let vec: Float32Array | null = null;
    if (linked.length > 0) {
      const embedded = await embedder.embed(linked.map((c) => c.text));
      if (embedded && embedded.length > 0) {
        vec = meanVec(embedded);
      }
    }
    if (!vec) {
      const embedded = await embedder.embed([topic.name]);
      vec = embedded?.[0] ?? hashEmbed(topic.name);
    }
    centroids.push({ topic, vec });
  }
  const leftoverVecs = await embedder.embed(leftover.map((c) => c.text));
  if (!leftoverVecs) {
    return;
  }
  leftover.forEach((chunk, i) => {
    const v = leftoverVecs[i];
    if (!v) {
      return;
    }
    let best: { topic: TopicRow; score: number } | null = null;
    for (const c of centroids) {
      const score = cosine(v, c.vec);
      if (!best || score > best.score) {
        best = { topic: c.topic, score };
      }
    }
    if (best && best.score >= TOPIC_ASSIGN_COSINE) {
      repo.addChunkTopics(best.topic.id, [{ chunk_id: chunk.id, weight: best.score }]);
    }
  });
}
