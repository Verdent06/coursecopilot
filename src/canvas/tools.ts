import type { CourseRepo } from "../db/repo.js";
import type { FetchLike } from "../ingest/crawl/fetch.js";
import { loadCanvasCredentials, loadCanvasIcsUrl } from "./auth.js";
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
import { fetchAndParseCanvasIcs } from "./ics.js";
import { htmlToMarkdown } from "./markdown.js";
import { type CanvasSnapshot, loadCanvasSnapshot } from "./snapshot.js";

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
  const client = tryClient(runtime);
  if (client) {
    const cache = cacheOf(runtime);
    const courses = await cache.getOrSet(`courses:${includePast}`, () =>
      client.listCourses(includePast),
    );
    return courses.map((c) => toListedCourse(c, repo));
  }
  const snap = mustSnapshot("courses");
  return snap.courses
    .filter((c) => includePast || c.workflow_state !== "completed")
    .map((c) => toListedCourse(c, repo));
}

export async function listLiveModules(runtime: CanvasRuntime, canvasCourseId: string) {
  const client = tryClient(runtime);
  const modules = client
    ? await cacheOf(runtime).getOrSet(`modules:${canvasCourseId}`, () =>
        client.listModules(canvasCourseId),
      )
    : (mustSnapshot("modules").modules[canvasCourseId] ?? []);
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
  const client = tryClient(runtime);
  const files = client
    ? (
        await cacheOf(runtime).getOrSet(`files:${canvasCourseId}`, () =>
          client.listFiles(canvasCourseId),
        )
      ).files
    : (mustSnapshot("files").files[canvasCourseId] ?? []);
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
  const client = tryClient(runtime);
  const pages = client
    ? await cacheOf(runtime).getOrSet(`pages:${canvasCourseId}`, () =>
        client.listPages(canvasCourseId),
      )
    : (mustSnapshot("pages").pages[canvasCourseId] ?? []);
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
  const client = tryClient(runtime);
  const page = client
    ? await client.getPage(canvasCourseId, pageUrl)
    : (mustSnapshot("pages").pages[canvasCourseId] ?? []).find(
        (p) => p.url === pageUrl || p.html_url === pageUrl,
      );
  if (!page) {
    throw new CanvasApiError({
      code: CANVAS_ERROR.notConfigured,
      message: `Page "${pageUrl}" is not in the extension snapshot. Sync again from Canvas.`,
    });
  }
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
  const client = tryClient(runtime);
  if (client) {
    return listAssignmentsFromClient(runtime, client, opts);
  }
  const snap = loadCanvasSnapshot();
  if (snap) {
    return listAssignmentsFromSnapshot(snap, opts);
  }
  const icsUrl = loadCanvasIcsUrl();
  if (icsUrl) {
    return listAssignmentsFromIcs(runtime, icsUrl, opts);
  }
  throw new CanvasApiError({ code: CANVAS_ERROR.notConfigured });
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
  const sinceDays = opts.sinceDays ?? 14;
  const now = opts.now ?? new Date();
  const start = new Date(now.getTime() - sinceDays * 86_400_000).toISOString();
  const startMs = Date.parse(start);

  const client = tryClient(runtime);
  let items: CanvasAnnouncement[];
  const names = new Map<string, string>();
  if (client) {
    let courseIds: string[];
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
    items = await cacheOf(runtime).getOrSet(`ann:${courseIds.join(",")}:${start}`, () =>
      client.listAnnouncements(courseIds, { startDate: start }),
    );
  } else {
    const snap = mustSnapshot("announcements");
    for (const c of snap.courses) {
      names.set(String(c.id), c.name);
    }
    items = snap.announcements.filter((a) => {
      if (!a.posted_at) {
        return true;
      }
      const t = Date.parse(a.posted_at);
      return Number.isFinite(t) && t >= startMs;
    });
    if (opts.canvasCourseId) {
      items = items.filter(
        (a) => courseIdFromAnnouncementUrl(a.html_url ?? "") === opts.canvasCourseId,
      );
    }
  }
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

function tryClient(runtime: CanvasRuntime): CanvasClient | undefined {
  const opened = openCanvas(runtime);
  return opened.ok ? opened.client : undefined;
}

function mustSnapshot(need: string): CanvasSnapshot {
  const snap = loadCanvasSnapshot();
  if (snap) {
    return snap;
  }
  const ics = loadCanvasIcsUrl();
  if (ics && need === "assignments") {
    throw new CanvasApiError({ code: CANVAS_ERROR.notConfigured });
  }
  throw new CanvasApiError({
    code: CANVAS_ERROR.notConfigured,
    message: ics
      ? `Calendar feed is connected (due dates only). For ${need}, pair the CourseCopilot browser extension or use a personal token if your school allows it.`
      : undefined,
  });
}

async function listAssignmentsFromClient(
  runtime: CanvasRuntime,
  client: CanvasClient,
  opts: { canvasCourseId?: string; upcomingOnly?: boolean; days?: number; now?: Date },
): Promise<ListedAssignment[]> {
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
  return filterMapAssignments(rows, { days, upcomingOnly, now, tz });
}

function listAssignmentsFromSnapshot(
  snap: CanvasSnapshot,
  opts: { canvasCourseId?: string; upcomingOnly?: boolean; days?: number; now?: Date },
): ListedAssignment[] {
  const names = new Map(snap.courses.map((c) => [String(c.id), c.name]));
  const ids = opts.canvasCourseId
    ? [opts.canvasCourseId]
    : Object.keys(snap.assignments).length > 0
      ? Object.keys(snap.assignments)
      : snap.courses.map((c) => String(c.id));
  const rows: Array<{ assignment: CanvasAssignment; courseName: string }> = [];
  for (const id of ids) {
    for (const assignment of snap.assignments[id] ?? []) {
      rows.push({
        assignment,
        courseName:
          names.get(id) ??
          (assignment.course_id != null ? (names.get(String(assignment.course_id)) ?? id) : id),
      });
    }
  }
  return filterMapAssignments(rows, {
    days: opts.days ?? 14,
    upcomingOnly: opts.upcomingOnly ?? true,
    now: opts.now ?? new Date(),
    tz: snap.self?.time_zone,
  });
}

async function listAssignmentsFromIcs(
  runtime: CanvasRuntime,
  icsUrl: string,
  opts: { canvasCourseId?: string; upcomingOnly?: boolean; days?: number; now?: Date },
): Promise<ListedAssignment[]> {
  const events = await cacheOf(runtime).getOrSet(`ics:${icsUrl}`, () =>
    fetchAndParseCanvasIcs(icsUrl, runtime.fetchFn, {
      allowPrivateNetwork: Boolean(runtime.fetchFn),
    }),
  );
  const days = opts.days ?? 14;
  const upcomingOnly = opts.upcomingOnly ?? true;
  const now = opts.now ?? new Date();
  const start = now.getTime();
  const end = start + days * 86_400_000;
  return events
    .filter((ev) => {
      if (opts.canvasCourseId && ev.course !== opts.canvasCourseId) {
        return false;
      }
      if (!upcomingOnly) {
        return true;
      }
      if (!ev.dueAt) {
        return false;
      }
      const t = Date.parse(ev.dueAt);
      return Number.isFinite(t) && t >= start && t <= end;
    })
    .map((ev) => {
      const due = formatDue(ev.dueAt, undefined);
      return {
        name: ev.summary,
        due_at: due.due_at,
        due_at_local: due.due_at_local,
        points: null,
        submission_types: [] as string[],
        html_url: ev.url,
        course: ev.course,
      };
    })
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
}

function filterMapAssignments(
  rows: Array<{ assignment: CanvasAssignment; courseName: string }>,
  opts: { days: number; upcomingOnly: boolean; now: Date; tz?: string },
): ListedAssignment[] {
  const start = opts.now.getTime();
  const end = start + opts.days * 86_400_000;
  return rows
    .filter(({ assignment }) => {
      if (!opts.upcomingOnly) {
        return true;
      }
      if (!assignment.due_at) {
        return false;
      }
      const t = Date.parse(assignment.due_at);
      return Number.isFinite(t) && t >= start && t <= end;
    })
    .map(({ assignment, courseName }) => {
      const due = formatDue(assignment.due_at ?? null, opts.tz);
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
