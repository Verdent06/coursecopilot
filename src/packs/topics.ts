import type { CourseRepo } from "../db/repo.js";
import { parseMeta } from "../retrieve/citation.js";
import { newId } from "../util/ids.js";
import type { PackTopic } from "./schema.js";

export function topicNamesFromMap(entries: PackTopic[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    for (const name of namesForEntry(entry)) {
      names.add(name);
    }
  }
  return [...names];
}

export function applyPackTopicNames(
  repo: CourseRepo,
  courseId: string,
  entries: PackTopic[],
): string[] {
  const ids: string[] = [];
  for (const name of topicNamesFromMap(entries)) {
    const topic = repo.upsertTopic({
      id: `t_${newId()}`,
      course_id: courseId,
      name,
      origin: "pack",
    });
    ids.push(topic.id);
  }
  return ids;
}

/**
 * Bind pack topics to chunks after ingest. Matches lecture_no / lecN in
 * title or URL, plus keyword hits on the entry title and topic names.
 */
export function applyPackTopicAssignments(
  repo: CourseRepo,
  courseId: string,
  entries: PackTopic[],
): string[] {
  const ids = applyPackTopicNames(repo, courseId, entries);
  const docs = repo.listDocumentsForCourse(courseId);
  for (const entry of entries) {
    for (const name of namesForEntry(entry)) {
      const topic = repo.getTopicByName(courseId, name);
      if (!topic) {
        continue;
      }
      const assignments: Array<{ chunk_id: number; weight: number }> = [];
      if (entry.lecture != null) {
        for (const doc of docs) {
          if (!documentMatchesLecture(doc.title, doc.url, doc.meta_json, entry.lecture)) {
            continue;
          }
          for (const chunk of repo.listChunksForDocument(doc.id)) {
            assignments.push({ chunk_id: chunk.id, weight: 1 });
          }
        }
      }
      const keywords = [entry.title, name].filter((s): s is string => Boolean(s?.trim()));
      if (keywords.length > 0) {
        for (const chunk of repo.findChunksMatchingKeywords(courseId, keywords)) {
          assignments.push({ chunk_id: chunk.id, weight: 0.8 });
        }
      }
      if (assignments.length > 0) {
        repo.addChunkTopics(topic.id, uniqueAssignments(assignments));
      }
    }
  }
  return ids;
}

export function applyInstalledPackTopics(repo: CourseRepo, courseId: string): void {
  const pack = repo.getPackByCourse(courseId);
  if (!pack) {
    return;
  }
  try {
    const manifest = JSON.parse(pack.manifest_json) as { topics?: PackTopic[] };
    if (Array.isArray(manifest.topics) && manifest.topics.length > 0) {
      applyPackTopicAssignments(repo, courseId, manifest.topics);
    }
  } catch {
    // stored manifest is best-effort
  }
}

export function documentMatchesLecture(
  title: string | null | undefined,
  url: string | null | undefined,
  metaJson: string | null | undefined,
  lecture: number,
): boolean {
  const meta = parseMeta(metaJson ?? null);
  if (typeof meta.lecture_no === "number" && meta.lecture_no === lecture) {
    return true;
  }
  const hay = `${title ?? ""} ${url ?? ""}`;
  const re = new RegExp(`(?:lecture|lec)[\\s._-]*0*${lecture}(?!\\d)`, "i");
  return re.test(hay);
}

function namesForEntry(entry: PackTopic): string[] {
  const names: string[] = [];
  if (entry.topics) {
    for (const name of entry.topics) {
      const trimmed = name.trim();
      if (trimmed) {
        names.push(trimmed);
      }
    }
  }
  if (
    entry.title?.trim() &&
    !names.some((n) => n.toLowerCase() === entry.title?.trim().toLowerCase())
  ) {
    names.push(entry.title.trim());
  }
  return names;
}

function uniqueAssignments(
  items: Array<{ chunk_id: number; weight: number }>,
): Array<{ chunk_id: number; weight: number }> {
  const best = new Map<number, number>();
  for (const item of items) {
    const prev = best.get(item.chunk_id);
    if (prev == null || item.weight > prev) {
      best.set(item.chunk_id, item.weight);
    }
  }
  return [...best.entries()].map(([chunk_id, weight]) => ({ chunk_id, weight }));
}
