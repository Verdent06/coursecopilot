import type { CourseRepo, SourceKind } from "../db/repo.js";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import type { IngestQueue } from "../ingest/queue.js";
import { isValidCourseId, newId } from "../util/ids.js";
import { assertPublicUrl } from "../util/ssrf.js";
import { nowIso } from "../util/time.js";
import { exportPackFromCourse } from "./export.js";
import type { RegistryClient } from "./registry.js";
import { resolvePack } from "./resolve.js";
import { PackError, type PackManifest } from "./schema.js";
import { applyPackTopicNames } from "./topics.js";

export type AddPackResult = {
  course_id: string;
  pack_id: string;
  job_ids: string[];
  skipped: Array<{ url: string; reason: string }>;
};

export type AddPackOptions = {
  repo: CourseRepo;
  queue: IngestQueue;
  registry: RegistryClient;
  pack: string;
  course_id?: string;
  allowLocalPaths?: boolean;
  allowPrivateNetwork?: boolean;
  fetchFn?: FetchLike;
};

export function courseIdFromPackId(packId: string): string {
  if (isValidCourseId(packId)) {
    return packId;
  }
  const slugged = packId.replace(/\./g, "-").replace(/_+/g, "-").replace(/-+/g, "-");
  if (isValidCourseId(slugged)) {
    return slugged;
  }
  throw new PackError(
    `Cannot derive course_id from pack id "${packId}". Pass course_id as a lowercase slug.`,
  );
}

export async function addPack(options: AddPackOptions): Promise<AddPackResult> {
  const resolved = await resolvePack(options.pack, {
    registry: options.registry,
    allowLocalPaths: options.allowLocalPaths,
    allowPrivateNetwork: options.allowPrivateNetwork,
    fetchFn: options.fetchFn,
  });
  const courseId = options.course_id?.trim()
    ? options.course_id.trim().toLowerCase()
    : courseIdFromPackId(resolved.manifest.id);

  if (options.repo.courseExists(courseId)) {
    throw new PackError(
      `course_id "${courseId}" already exists. Wipe it first or pass a different course_id.`,
    );
  }
  const existingPack = options.repo.getPack(resolved.manifest.id);
  if (existingPack) {
    throw new PackError(
      `Pack "${resolved.manifest.id}" is already installed on course "${existingPack.course_id}".`,
    );
  }

  options.repo.addCourse({
    title: resolved.manifest.name,
    term: resolved.manifest.term,
    course_id: courseId,
  });

  const skipped: Array<{ url: string; reason: string }> = [];
  const job_ids: string[] = [];

  for (const source of resolved.manifest.sources) {
    try {
      if (options.allowPrivateNetwork === false) {
        assertPublicUrl(source.url);
      }
      const kind = packSourceKindToDb(source.kind);
      const row = options.repo.insertSource({
        id: newId(),
        course_id: courseId,
        kind,
        uri: source.url,
        title: source.title ?? null,
        config_json: JSON.stringify({
          ...(source.max_depth != null ? { max_depth: source.max_depth } : {}),
          ...(source.max_pages != null ? { max_pages: source.max_pages } : {}),
          ...(source.include_prefix ? { include_prefix: source.include_prefix } : {}),
          ...(source.lecture != null ? { lecture_no: source.lecture } : {}),
          as_slides: source.as_slides ?? source.kind === "pdf",
        }),
        status: "queued",
      });
      job_ids.push(options.queue.submit(row.id));
    } catch (err) {
      skipped.push({
        url: source.url,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const note of resolved.manifest.connect_yourself ?? []) {
    skipped.push({ url: note.kind, reason: note.message });
  }

  applyPackTopicNames(options.repo, courseId, resolved.manifest.topics ?? []);
  options.repo.upsertPack({
    id: resolved.manifest.id,
    course_id: courseId,
    version: resolved.manifest.version,
    origin: resolved.origin,
    manifest_json: JSON.stringify(resolved.manifest),
    installed_at: nowIso(),
  });

  return {
    course_id: courseId,
    pack_id: resolved.manifest.id,
    job_ids,
    skipped,
  };
}

export function packSourceKindToDb(kind: PackManifest["sources"][number]["kind"]): SourceKind {
  if (kind === "pdf") {
    return "website";
  }
  return kind;
}

export function stringifyManifest(manifest: PackManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function exportPackToObject(
  repo: CourseRepo,
  courseId: string,
  includeLocalPaths = false,
): { manifest: PackManifest; warnings: string[] } {
  return exportPackFromCourse(repo, courseId, { include_local_paths: includeLocalPaths });
}
