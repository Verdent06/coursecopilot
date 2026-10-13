import type { FetchLike } from "../ingest/crawl/fetch.js";
import { crawlUserAgent } from "../ingest/crawl/ua.js";
import type { CanvasCredentials } from "./auth.js";
import {
  CANVAS_ERROR,
  CanvasApiError,
  classifyCanvasAuthError,
  looksLikeTokenPolicy,
} from "./errors.js";

export type CanvasUser = {
  id: number;
  name: string;
  time_zone?: string;
};

export type CanvasCourse = {
  id: number;
  name: string;
  course_code: string;
  workflow_state?: string;
  term?: { name?: string; start_at?: string | null; end_at?: string | null };
};

export type CanvasModuleItem = {
  id: number;
  title: string;
  type: string;
  html_url?: string;
  url?: string;
  external_url?: string;
  page_url?: string;
  content_id?: number;
  published?: boolean;
  content_details?: { locked?: boolean; hidden?: boolean };
};

export type CanvasModule = {
  id: number;
  name: string;
  position?: number;
  published?: boolean;
  items?: CanvasModuleItem[];
  state?: string;
};

export type CanvasPage = {
  url: string;
  title: string;
  body?: string;
  html_url?: string;
  updated_at?: string;
  published?: boolean;
  front_page?: boolean;
  locked_for_user?: boolean;
};

export type CanvasFile = {
  id: number;
  display_name?: string;
  filename?: string;
  url?: string;
  html_url?: string;
  content_type?: string;
  updated_at?: string;
  size?: number;
  locked?: boolean;
  hidden?: boolean;
  media_entry_id?: string | number | null;
};

export type CanvasAssignment = {
  id: number;
  name: string;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  html_url?: string;
  description?: string | null;
  assignment_group_id?: number;
  published?: boolean;
  locked_for_user?: boolean;
  course_id?: number;
};

export type CanvasAssignmentGroup = {
  id: number;
  name: string;
  group_weight?: number | null;
};

export type CanvasAnnouncement = {
  id: number;
  title: string;
  message?: string;
  posted_at?: string;
  html_url?: string;
};

export type CanvasUpcomingEvent = {
  title?: string;
  html_url?: string;
  start_at?: string;
  assignment?: CanvasAssignment;
};

export type QueryValue = string | number | boolean | Array<string | number> | undefined;

export type CanvasClientOptions = {
  credentials: CanvasCredentials;
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Slow down when X-Rate-Limit-Remaining is below this (spec: 50). */
  rateLimitFloor?: number;
};

const DEFAULT_PER_PAGE = 100;
const RATE_FLOOR = 50;

export class CanvasClient {
  private remaining = 700;
  private readonly fetchFn: FetchLike;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly rateFloor: number;
  readonly baseUrl: string;
  readonly token: string;

  constructor(opts: CanvasClientOptions) {
    this.baseUrl = opts.credentials.baseUrl.replace(/\/+$/, "");
    this.token = opts.credentials.token;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleepFn = opts.sleep ?? sleep;
    this.rateFloor = opts.rateLimitFloor ?? RATE_FLOOR;
  }

  async getSelf(): Promise<CanvasUser> {
    try {
      return await this.getJson<CanvasUser>("/api/v1/users/self");
    } catch (err) {
      if (err instanceof CanvasApiError && (err.status === 401 || err.status === 403)) {
        throw new CanvasApiError({
          code:
            err.status === 403 || err.code === CANVAS_ERROR.tokensBlocked
              ? CANVAS_ERROR.tokensBlocked
              : CANVAS_ERROR.tokenRejected,
          status: err.status,
        });
      }
      throw err;
    }
  }

  async listCourses(includePast = false): Promise<CanvasCourse[]> {
    if (includePast) {
      return this.getAllPages<CanvasCourse>("/api/v1/courses", {
        "include[]": "term",
        "state[]": ["available", "completed"],
      });
    }
    return this.getAllPages<CanvasCourse>("/api/v1/courses", {
      enrollment_state: "active",
      "include[]": "term",
    });
  }

  async getCourse(courseId: string | number): Promise<CanvasCourse> {
    return this.getJson<CanvasCourse>(`/api/v1/courses/${courseId}`, { "include[]": "term" });
  }

  async listModules(courseId: string | number): Promise<CanvasModule[]> {
    return this.getAllPages<CanvasModule>(`/api/v1/courses/${courseId}/modules`, {
      "include[]": "items",
    });
  }

  async listPages(courseId: string | number): Promise<CanvasPage[]> {
    return this.getAllPages<CanvasPage>(`/api/v1/courses/${courseId}/pages`);
  }

  async getPage(courseId: string | number, pageUrl: string): Promise<CanvasPage> {
    const encoded = encodeURIComponent(pageUrl);
    return this.getJson<CanvasPage>(`/api/v1/courses/${courseId}/pages/${encoded}`);
  }

  async getFrontPage(courseId: string | number): Promise<CanvasPage | null> {
    try {
      return await this.getJson<CanvasPage>(`/api/v1/courses/${courseId}/front_page`);
    } catch (err) {
      if (err instanceof CanvasApiError && (err.status === 404 || err.status === 403)) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Course file list. Students often get 403; then we collect File items from modules.
   */
  async listFiles(
    courseId: string | number,
  ): Promise<{ files: CanvasFile[]; via: "files" | "modules" }> {
    try {
      const files = await this.getAllPages<CanvasFile>(`/api/v1/courses/${courseId}/files`);
      return { files, via: "files" };
    } catch (err) {
      if (err instanceof CanvasApiError && err.status === 403) {
        return { files: await this.filesFromModuleItems(courseId), via: "modules" };
      }
      throw err;
    }
  }

  async getFile(fileId: string | number): Promise<CanvasFile> {
    return this.getJson<CanvasFile>(`/api/v1/files/${fileId}`);
  }

  async listAssignments(
    courseId: string | number,
    opts: { upcomingOnly?: boolean } = {},
  ): Promise<CanvasAssignment[]> {
    const query: Record<string, QueryValue> = {};
    if (opts.upcomingOnly) {
      query.bucket = "upcoming";
    }
    return this.getAllPages<CanvasAssignment>(`/api/v1/courses/${courseId}/assignments`, query);
  }

  async listAssignmentGroups(courseId: string | number): Promise<CanvasAssignmentGroup[]> {
    return this.getAllPages<CanvasAssignmentGroup>(`/api/v1/courses/${courseId}/assignment_groups`);
  }

  async upcomingEvents(): Promise<CanvasUpcomingEvent[]> {
    return this.getAllPages<CanvasUpcomingEvent>("/api/v1/users/self/upcoming_events");
  }

  async listAnnouncements(
    courseIds: Array<string | number>,
    opts: { startDate?: string } = {},
  ): Promise<CanvasAnnouncement[]> {
    if (courseIds.length === 0) {
      return [];
    }
    const query: Record<string, QueryValue> = {
      "context_codes[]": courseIds.map((id) => `course_${id}`),
    };
    if (opts.startDate) {
      query.start_date = opts.startDate;
    }
    return this.getAllPages<CanvasAnnouncement>("/api/v1/announcements", query);
  }

  async downloadFile(
    file: CanvasFile,
  ): Promise<{ bytes: Uint8Array; contentType: string; url: string }> {
    const url = file.url;
    if (!url) {
      const fresh = await this.getFile(file.id);
      if (!fresh.url) {
        throw new CanvasApiError({
          code: CANVAS_ERROR.tokenRejected,
          message: `Canvas file ${file.id} has no download URL`,
          status: 404,
        });
      }
      return this.downloadUrl(fresh.url);
    }
    return this.downloadUrl(url);
  }

  async getAllPages<T>(path: string, query?: Record<string, QueryValue>): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = this.resolveUrl(path, { per_page: DEFAULT_PER_PAGE, ...query });
    while (next) {
      const { data, response } = await this.request(next);
      if (Array.isArray(data)) {
        out.push(...(data as T[]));
      }
      next = parseLinkNext(response.headers.get("link"));
    }
    return out;
  }

  async getJson<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    const { data } = await this.request(this.resolveUrl(path, query));
    return data as T;
  }

  private async filesFromModuleItems(courseId: string | number): Promise<CanvasFile[]> {
    const modules = await this.listModules(courseId);
    const ids = new Set<number>();
    for (const mod of modules) {
      for (const item of mod.items ?? []) {
        if (item.type === "File" && item.content_id != null) {
          ids.add(Number(item.content_id));
        }
      }
    }
    const files: CanvasFile[] = [];
    for (const id of ids) {
      try {
        files.push(await this.getFile(id));
      } catch {
        // unpublished / locked file
      }
    }
    return files;
  }

  private async downloadUrl(
    url: string,
  ): Promise<{ bytes: Uint8Array; contentType: string; url: string }> {
    await this.respectRateLimit();
    const response = await this.fetchFn(url, {
      method: "GET",
      redirect: "follow",
      headers: this.headers("application/octet-stream"),
      signal: AbortSignal.timeout(60_000),
    });
    this.noteRateLimit(response);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw this.errorFromStatus(response.status, body);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      contentType: response.headers.get("content-type") || "",
      url: response.url || url,
    };
  }

  private async request(url: string): Promise<{ data: unknown; response: Response }> {
    await this.respectRateLimit();
    const response = await this.fetchFn(url, {
      method: "GET",
      redirect: "follow",
      headers: this.headers("application/json"),
      signal: AbortSignal.timeout(30_000),
    });
    this.noteRateLimit(response);
    const text = await response.text();
    if (!response.ok) {
      throw this.errorFromStatus(response.status, text);
    }
    if (!text) {
      return { data: null, response };
    }
    try {
      return { data: JSON.parse(text) as unknown, response };
    } catch {
      throw new CanvasApiError({
        code: CANVAS_ERROR.tokenRejected,
        message: "Canvas returned a non-JSON body",
        status: response.status,
      });
    }
  }

  private headers(accept: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: accept,
      "User-Agent": crawlUserAgent(),
    };
  }

  private resolveUrl(pathOrUrl: string, query?: Record<string, QueryValue>): string {
    const url =
      pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")
        ? new URL(pathOrUrl)
        : new URL(pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`, `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.href;
  }

  private noteRateLimit(response: Response): void {
    const raw = response.headers.get("x-rate-limit-remaining");
    if (raw == null) {
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
      this.remaining = n;
    }
  }

  private async respectRateLimit(): Promise<void> {
    if (this.remaining >= this.rateFloor) {
      return;
    }
    const wait = Math.min(2_000, 200 + (this.rateFloor - this.remaining) * 40);
    await this.sleepFn(wait);
  }

  private errorFromStatus(status: number, body: string): CanvasApiError {
    if (status === 401 || looksLikeTokenPolicy(body)) {
      return new CanvasApiError({
        code: classifyCanvasAuthError(status, body),
        status,
      });
    }
    if (status === 403) {
      return new CanvasApiError({
        code: CANVAS_ERROR.tokenRejected,
        message: "Canvas returned HTTP 403",
        status,
      });
    }
    return new CanvasApiError({
      code: CANVAS_ERROR.tokenRejected,
      message: `Canvas returned HTTP ${status}`,
      status,
    });
  }
}

export function parseLinkNext(link: string | null): string | null {
  if (!link) {
    return null;
  }
  for (const part of link.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel=["']?next["']?/i.exec(part);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCanvasClient(
  creds: CanvasCredentials,
  opts: Omit<CanvasClientOptions, "credentials"> = {},
): CanvasClient {
  return new CanvasClient({ credentials: creds, ...opts });
}
