import type { CourseRepo, SourceKind, SourceListItem } from "../db/repo.js";
import { RepoError } from "../db/repo.js";
import { looksLikePdfUrl } from "../ingest/crawl/skip.js";
import { parseSourceConfig } from "../ingest/source-config.js";
import {
  classifyDroppedSource,
  type DroppedSourceKind,
  hostFromUri,
  placeholderMessage,
} from "./gated.js";
import {
  type PackConnectYourself,
  PackError,
  type PackExam,
  type PackManifest,
  type PackSource,
  type PackTopic,
  packIdSchema,
} from "./schema.js";

export type ExportPackResult = {
  manifest: PackManifest;
  warnings: string[];
};

export function exportPackFromCourse(
  repo: CourseRepo,
  courseId: string,
  options: { include_local_paths?: boolean } = {},
): ExportPackResult {
  repo.requireCourse(courseId);
  const course = repo.getCourseInfo(courseId);
  if (!course) {
    throw new RepoError(repo.unknownCourseMessage(courseId));
  }

  const installed = repo.getPackByCourse(courseId);
  let base: Partial<PackManifest> = {};
  if (installed) {
    try {
      base = JSON.parse(installed.manifest_json) as PackManifest;
    } catch {
      base = {};
    }
  }

  const warnings: string[] = [];
  const sources: PackSource[] = [];
  const dropped = new Map<DroppedSourceKind, { host?: string }>();

  for (const source of repo.listSources(courseId)) {
    const full = repo.getSource(source.source_id);
    const kind = source.kind;
    const uri = source.uri;
    const drop = classifyDroppedSource(uri, kind);
    if (drop) {
      if (drop === "local_files" && options.include_local_paths) {
        warnings.push(
          `Local source not added as a pack URL (http(s) only): ${uri}. Listed under connect_yourself.`,
        );
      } else {
        warnings.push(`Dropped ${drop} source: ${uri}`);
      }
      dropped.set(drop, { host: hostFromUri(uri) });
      continue;
    }
    if (!/^https?:\/\//i.test(uri)) {
      warnings.push(`Dropped non-http source: ${uri}`);
      dropped.set("local_files", {});
      continue;
    }
    const exported = sourceToPackSource(source, full?.config_json ?? null);
    if (exported) {
      sources.push(exported);
    }
  }

  if (sources.length === 0) {
    throw new PackError(
      `Course "${courseId}" has no exportable http(s) website, PDF, YouTube, or transcript sources. ` +
        `Canvas, lecture-capture (leccap), and local files are never exported.`,
    );
  }

  const connect_yourself = mergeConnectYourself(
    Array.isArray(base.connect_yourself) ? base.connect_yourself : [],
    dropped,
  );

  const id = packIdSchema.safeParse(base.id)?.success
    ? (base.id as string)
    : packIdSchema.safeParse(courseId).success
      ? courseId
      : courseId.replace(/\./g, "-");

  const parsedId = packIdSchema.safeParse(id);
  if (!parsedId.success) {
    throw new PackError(
      `Cannot derive a pack id from course "${courseId}". Re-add the course with a slug id.`,
    );
  }

  const topics = (
    Array.isArray(base.topics) && base.topics.length > 0
      ? base.topics
      : reconstructTopics(repo, courseId)
  ) as PackTopic[];

  const exams: PackExam[] = (
    Array.isArray(base.exams) && base.exams.length > 0
      ? base.exams
      : course.exams.map((exam) => ({
          name: exam.name,
          topics: exam.topics,
        }))
  ).map((exam) => ({ name: exam.name, topics: exam.topics ?? [] }));

  const manifest: PackManifest = {
    schema: 1,
    id: parsedId.data,
    name: typeof base.name === "string" && base.name ? base.name : course.title,
    version: typeof base.version === "string" && base.version ? base.version : "1.0.0",
    sources,
    ...(typeof base.institution === "string" && base.institution
      ? { institution: base.institution }
      : {}),
    ...(course.term
      ? { term: course.term }
      : typeof base.term === "string"
        ? { term: base.term }
        : {}),
    ...(typeof base.license_note === "string" ? { license_note: base.license_note } : {}),
    ...(Array.isArray(base.maintainers) ? { maintainers: base.maintainers } : {}),
    ...(topics.length > 0 ? { topics } : {}),
    ...(exams.length > 0 ? { exams } : {}),
    ...(connect_yourself.length > 0 ? { connect_yourself } : {}),
  };

  return { manifest, warnings };
}

function sourceToPackSource(source: SourceListItem, configJson: string | null): PackSource | null {
  const cfg = parseSourceConfig(configJson);
  const kind = packKindForSource(source.kind, source.uri);
  if (!kind) {
    return null;
  }
  const out: PackSource = { kind, url: source.uri };
  if (cfg.max_depth != null) {
    out.max_depth = cfg.max_depth;
  }
  if (cfg.max_pages != null) {
    out.max_pages = cfg.max_pages;
  }
  if (cfg.include_prefix) {
    out.include_prefix = cfg.include_prefix;
  }
  if (cfg.lecture_no != null) {
    out.lecture = cfg.lecture_no;
  }
  if (cfg.as_slides != null) {
    out.as_slides = cfg.as_slides;
  }
  return out;
}

function packKindForSource(kind: SourceKind, uri: string): PackSource["kind"] | null {
  if (kind === "website") {
    return looksLikePdfUrl(uri) ? "pdf" : "website";
  }
  if (kind === "youtube") {
    return "youtube";
  }
  if (kind === "transcript") {
    return "transcript";
  }
  return null;
}

function reconstructTopics(repo: CourseRepo, courseId: string): PackTopic[] {
  const topics = repo.listTopics(courseId);
  const entries: PackTopic[] = [];
  for (const topic of topics) {
    const chunks = repo.listChunksForTopic(topic.id);
    const lectures = new Set<number>();
    for (const chunk of chunks) {
      const meta = chunk.meta_json;
      const title = chunk.doc_title;
      const url = chunk.doc_url;
      const fromMeta = (() => {
        try {
          const parsed = meta ? (JSON.parse(meta) as { lecture_no?: unknown }) : {};
          return typeof parsed.lecture_no === "number" ? parsed.lecture_no : null;
        } catch {
          return null;
        }
      })();
      if (fromMeta != null) {
        lectures.add(fromMeta);
        continue;
      }
      const m = /(?:lecture|lec)[\s._-]*0*(\d+)/i.exec(`${title ?? ""} ${url ?? ""}`);
      if (m?.[1]) {
        lectures.add(Number(m[1]));
      }
    }
    if (lectures.size === 0) {
      entries.push({ title: topic.name, topics: [topic.name] });
      continue;
    }
    for (const lecture of [...lectures].sort((a, b) => a - b)) {
      entries.push({ lecture, title: topic.name, topics: [topic.name] });
    }
  }
  return entries;
}

function mergeConnectYourself(
  existing: PackConnectYourself[],
  dropped: Map<DroppedSourceKind, { host?: string }>,
): PackConnectYourself[] {
  const out = [...existing];
  const seen = new Set(out.map((item) => item.kind));
  for (const [kind, info] of dropped) {
    if (seen.has(kind)) {
      continue;
    }
    seen.add(kind);
    out.push({
      kind,
      message: placeholderMessage(kind, info.host),
      ...(info.host ? { host: info.host } : {}),
    });
  }
  return out;
}
