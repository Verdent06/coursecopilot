import type { CourseRepo } from "../db/repo.js";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import { loadCanvasCredentials } from "./auth.js";
import { TtlCache } from "./cache.js";
import {
  type CanvasAnnouncement,
  type CanvasAssignment,
  type CanvasClient,
  type CanvasClientOptions,
  type CanvasCourse,
  createCanvasClient,
} from "./client.js";
import {
  CANVAS_ERROR,
  CanvasApiError,
  type CanvasErrorPayload,
  canvasErrorPayload,
} from "./errors.js";
import { htmlToMarkdown } from "./markdown.js";

export type CanvasRuntime = {
  client?: CanvasClient;
  fetchFn?: FetchLike;
  cache?: TtlCache;
  clientOptions?: Omit<CanvasClientOptions, "credentials" | "fetchFn">;
};

export type OpenCanvas =
  | { ok: true; client: CanvasClient }
  | { ok: false; error: CanvasErrorPayload };

const defaultCache = new TtlCache(30_000);

export function openCanvas(runtime: CanvasRuntime = {}): OpenCanvas {
  if (runtime.client) {
    return { ok: true, client: runtime.client };
  }
  const creds = loadCanvasCredentials();
  if (!creds) {
    return { ok: false, error: canvasErrorPayload(CANVAS_ERROR.notConfigured) };
  }
  return {
    ok: true,
    client: createCanvasClient(creds, {
      fetchFn: runtime.fetchFn,
      ...runtime.clientOptions,
    }),
  };
}

export function cacheOf(runtime: CanvasRuntime): TtlCache {
  return runtime.cache ?? defaultCache;
}

export type ListedCanvasCourse = {
  canvas_course_id: string;
  name: string;
  course_code: string;
  term: string | null;
  linked_course_id: string | null;
};

export async function listLiveCourses(
  runtime: CanvasRuntime,
  repo: CourseRepo,
  includePast = false,
): Promise<ListedCanvasCourse[]> {
  const client = mustClient(runtime);
  const cache = cacheOf(runtime);
  const courses = await cache.getOrSet(`courses:${includePast}`, () =>
    client.listCourses(includePast),
  );
  return courses.map((c) => toListedCourse(c, repo));
}

export async function listLiveModules(runtime: CanvasRuntime, canvasCourseId: string) {
  const client = mustClient(runtime);
  const modules = await cacheOf(runtime).getOrSet(`modules:${canvasCourseId}`, () =>
    client.listModules(canvasCourseId),
  );
  return modules.map((mod) => ({
    module: mod.name,
    items: (mod.items ?? []).map((item) => ({
      type: item.type,
      title: item.title,
      html_url: item.html_url ?? item.external_url ?? item.url ?? "",
      locked: Boolean(item.content_details?.locked || mod.state === "locked"),
    })),
  }));
}

export async function listLiveFiles(
  runtime: CanvasRuntime,
  canvasCourseId: string,
  search?: string,
) {
  const client = mustClient(runtime);
  const { files } = await cacheOf(runtime).getOrSet(`files:${canvasCourseId}`, () =>
    client.listFiles(canvasCourseId),
  );
  const q = search?.trim().toLowerCase();
  return files
    .filter((f) => {
      if (f.media_entry_id) {
        return false;
      }
      if (!q) {
        return true;
      }
      const name = `${f.display_name ?? ""} ${f.filename ?? ""}`.toLowerCase();
      return name.includes(q);
    })
    .map((f) => ({
      id: String(f.id),
      title: f.display_name || f.filename || `file ${f.id}`,
      url: f.html_url || f.url || "",
      updated_at: f.updated_at ?? null,
    }));
}

export async function listLivePages(
  runtime: CanvasRuntime,
  canvasCourseId: string,
  search?: string,
) {
  const client = mustClient(runtime);
  const pages = await cacheOf(runtime).getOrSet(`pages:${canvasCourseId}`, () =>
    client.listPages(canvasCourseId),
  );
  const q = search?.trim().toLowerCase();
  return pages
    .filter((p) => !q || p.title.toLowerCase().includes(q) || p.url.toLowerCase().includes(q))
    .map((p) => ({
      id: p.url,
      title: p.title,
      url: p.html_url || "",
      updated_at: p.updated_at ?? null,
    }));
}

export async function getLivePage(runtime: CanvasRuntime, canvasCourseId: string, pageUrl: string) {
  const client = mustClient(runtime);
  const page = await client.getPage(canvasCourseId, pageUrl);
  const htmlUrl = page.html_url || "";
  const { markdown } = htmlToMarkdown(page.body ?? "", htmlUrl, page.title);
  return { title: page.title, body_markdown: markdown, html_url: htmlUrl };
}

export type ListedAssignment = {
  name: string;
  due_at: string | null;
  due_at_local: string | null;
  points: number | null;
  submission_types: string[];
  html_url: string;
  course: string;
};

export async function listLiveAssignments(
  runtime: CanvasRuntime,
  opts: { canvasCourseId?: string; upcomingOnly?: boolean; days?: number; now?: Date } = {},
): Promise<ListedAssignment[]> {
  const client = mustClient(runtime);
  const days = opts.days ?? 14;
  const upcomingOnly = opts.upcomingOnly ?? true;
  const now = opts.now ?? new Date();
  const self = await cacheOf(runtime).getOrSet("self", () => client.getSelf());
  const tz = self.time_zone;

  let rows: Array<{ assignment: CanvasAssignment; courseName: string }>;
  if (opts.canvasCourseId) {
    const course = await cacheOf(runtime).getOrSet(`course:${opts.canvasCourseId}`, () =>
      client.getCourse(opts.canvasCourseId as string),
    );
    const assignments = await client.listAssignments(opts.canvasCourseId, {
      upcomingOnly,
    });
    rows = assignments.map((assignment) => ({ assignment, courseName: course.name }));
  } else {
    const courses = await cacheOf(runtime).getOrSet("courses:false", () =>
      client.listCourses(false),
    );
    rows = [];
    for (const course of courses) {
      const assignments = await client.listAssignments(course.id, { upcomingOnly });
      for (const assignment of assignments) {
        rows.push({ assignment, courseName: course.name });
      }
    }
  }

  const windowMs = days * 86_400_000;
  const start = now.getTime();
  const end = start + windowMs;
  return rows
    .filter(({ assignment }) => {
      if (!upcomingOnly) {
        return true;
      }
      if (!assignment.due_at) {
        return false;
      }
      const t = Date.parse(assignment.due_at);
      return Number.isFinite(t) && t >= start && t <= end;
    })
    .map(({ assignment, courseName }) => {
      const due = formatDue(assignment.due_at ?? null, tz);
      return {
        name: assignment.name,
        due_at: due.due_at,
        due_at_local: due.due_at_local,
        points: assignment.points_possible ?? null,
        submission_types: assignment.submission_types ?? [],
        html_url: assignment.html_url ?? "",
        course: courseName,
      };
    })
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
}

export type ListedAnnouncement = {
  title: string;
  posted_at: string | null;
  message_markdown: string;
  html_url: string;
  course?: string;
};

export async function listLiveAnnouncements(
  runtime: CanvasRuntime,
  opts: { canvasCourseId?: string; sinceDays?: number; now?: Date } = {},
): Promise<ListedAnnouncement[]> {
  const client = mustClient(runtime);
  const sinceDays = opts.sinceDays ?? 14;
  const now = opts.now ?? new Date();
  const start = new Date(now.getTime() - sinceDays * 86_400_000).toISOString();

  let courseIds: string[];
  const names = new Map<string, string>();
  if (opts.canvasCourseId) {
    courseIds = [opts.canvasCourseId];
  } else {
    const courses = await cacheOf(runtime).getOrSet("courses:false", () =>
      client.listCourses(false),
    );
    courseIds = courses.map((c) => String(c.id));
    for (const c of courses) {
      names.set(String(c.id), c.name);
    }
  }

  const items = await cacheOf(runtime).getOrSet(`ann:${courseIds.join(",")}:${start}`, () =>
    client.listAnnouncements(courseIds, { startDate: start }),
  );
  return items.map((a: CanvasAnnouncement) => {
    const htmlUrl = a.html_url ?? "";
    const { markdown } = htmlToMarkdown(a.message ?? "", htmlUrl, a.title);
    const courseId = courseIdFromAnnouncementUrl(htmlUrl);
    return {
      title: a.title,
      posted_at: a.posted_at ?? null,
      message_markdown: markdown,
      html_url: htmlUrl,
      course: courseId ? names.get(courseId) : undefined,
    };
  });
}

function mustClient(runtime: CanvasRuntime): CanvasClient {
  const opened = openCanvas(runtime);
  if (!opened.ok) {
    throw new CanvasApiError({ code: opened.error.error });
  }
  return opened.client;
}

function toListedCourse(course: CanvasCourse, repo: CourseRepo): ListedCanvasCourse {
  return {
    canvas_course_id: String(course.id),
    name: course.name,
    course_code: course.course_code,
    term: course.term?.name ?? null,
    linked_course_id: repo.findLinkedCourseByCanvasId(String(course.id)) ?? null,
  };
}

export function formatDue(
  dueAt: string | null,
  timeZone?: string,
): { due_at: string | null; due_at_local: string | null } {
  if (!dueAt) {
    return { due_at: null, due_at_local: null };
  }
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) {
    return { due_at: dueAt, due_at_local: null };
  }
  let local: string | null = null;
  try {
    local = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    local = date.toISOString();
  }
  return { due_at: date.toISOString(), due_at_local: local };
}

function courseIdFromAnnouncementUrl(url: string): string | undefined {
  const match = /\/courses\/(\d+)/.exec(url);
  return match?.[1];
}
