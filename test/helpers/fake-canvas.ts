import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { FetchLike } from "../../src/ingest/crawl/fetch.js";
import { buildSimplePdf, LEC07_PAGES } from "./sample-files.js";

export const VALID_TOKEN = "valid-token";
export const EXPIRED_TOKEN = "expired-token";
export const BLOCKED_TOKEN = "blocked-token";

export const COURSE_101 = 101;
export const COURSE_102 = 102;
export const FILE_LEC07 = 55;

export type FakeCanvasOptions = {
  /** Remaining budget advertised on every response (throttle tests). */
  rateLimitRemaining?: number;
  /** When true, GET /courses/101/files succeeds instead of 403. */
  allowFilesList?: boolean;
  now?: Date;
};

export type FakeCanvas = {
  fetch: FetchLike;
  pdf: Buffer;
  handle: (req: IncomingMessage, res: ServerResponse) => void;
};

export function dueInDays(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

export async function createFakeCanvas(opts: FakeCanvasOptions = {}): Promise<FakeCanvas> {
  const pdf = buildSimplePdf(LEC07_PAGES, { landscape: true });
  const now = opts.now ?? new Date("2026-10-13T12:00:00.000Z");
  const hwDue = dueInDays(3, now);
  const midtermDue = dueInDays(10, now);
  const posted = new Date(now.getTime() - 2 * 86_400_000).toISOString();

  const handleRequest = (input: {
    url: URL;
    authorization: string;
  }): { status: number; headers: Record<string, string>; body: Buffer | string } => {
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "x-rate-limit-remaining": String(opts.rateLimitRemaining ?? 700),
    };
    const token = bearer(input.authorization);
    const path = input.url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/files/55/download") {
      return {
        status: 200,
        headers: { ...headers, "content-type": "application/pdf" },
        body: pdf,
      };
    }

    if (!token) {
      return json(401, { errors: [{ message: "Invalid access token." }] }, headers);
    }
    if (token === EXPIRED_TOKEN) {
      return json(401, { errors: [{ message: "Invalid access token." }] }, headers);
    }
    if (token === BLOCKED_TOKEN) {
      return json(
        403,
        { message: "Personal access tokens are disabled for this account." },
        headers,
      );
    }
    if (token !== VALID_TOKEN) {
      return json(401, { errors: [{ message: "Invalid access token." }] }, headers);
    }

    if (path === "/api/v1/users/self") {
      return json(200, { id: 9, name: "Jane Student", time_zone: "America/Detroit" }, headers);
    }

    if (path === "/api/v1/users/self/upcoming_events") {
      return json(
        200,
        [
          {
            title: "Homework 1",
            start_at: hwDue,
            html_url: html(input.url, `/courses/${COURSE_101}/assignments/9`),
            assignment: assignmentHw(input.url, hwDue),
          },
        ],
        headers,
      );
    }

    if (path === "/api/v1/announcements") {
      const codes = input.url.searchParams.getAll("context_codes[]");
      const items = [];
      if (codes.includes(`course_${COURSE_101}`) || codes.length === 0) {
        items.push({
          id: 70,
          title: "Office hours moved",
          message: "<p>Office hours are now in Beyster 1620.</p>",
          posted_at: posted,
          html_url: html(input.url, `/courses/${COURSE_101}/discussion_topics/70`),
        });
      }
      return json(200, items, headers);
    }

    if (path === "/api/v1/courses") {
      const page = Number(input.url.searchParams.get("page") || "1");
      const all = [course101(input.url), course102(input.url)];
      const list = all;
      // Force Link pagination: one course per page.
      const item = list[page - 1];
      const next =
        page < list.length
          ? `<${originOf(input.url)}/api/v1/courses?page=${page + 1}&per_page=100>; rel="next"`
          : undefined;
      if (next) {
        headers.link = next;
      }
      return json(200, item ? [item] : [], headers);
    }

    const courseMatch = /^\/api\/v1\/courses\/(\d+)$/.exec(path);
    if (courseMatch) {
      const id = Number(courseMatch[1]);
      if (id === COURSE_101) {
        return json(200, course101(input.url), headers);
      }
      if (id === COURSE_102) {
        return json(200, course102(input.url), headers);
      }
      return json(404, { message: "not found" }, headers);
    }

    const sub = /^\/api\/v1\/courses\/(\d+)\/([a-z_]+)$/.exec(path);
    if (sub) {
      const id = Number(sub[1]);
      const resource = sub[2];
      if (resource === "front_page") {
        if (id !== COURSE_101) {
          return json(404, { message: "no front page" }, headers);
        }
        return json(200, frontPage(input.url), headers);
      }
      if (resource === "pages") {
        const page = Number(input.url.searchParams.get("page") || "1");
        if (id !== COURSE_101) {
          return json(200, [], headers);
        }
        if (page === 1) {
          headers.link = `<${originOf(input.url)}/api/v1/courses/${id}/pages?page=2&per_page=100>; rel="next"`;
          return json(200, [pageWelcome(input.url, false)], headers);
        }
        return json(200, [pageReading(input.url, false), pageSyllabus(input.url, false)], headers);
      }
      if (resource === "modules") {
        return json(200, modules(input.url, id), headers);
      }
      if (resource === "files") {
        if (id !== COURSE_101) {
          return json(200, [], headers);
        }
        if (!opts.allowFilesList) {
          return json(403, { message: "user not authorized to perform that action" }, headers);
        }
        return json(200, [fileLec07(input.url)], headers);
      }
      if (resource === "assignments") {
        if (id === COURSE_101) {
          return json(
            200,
            [assignmentHw(input.url, hwDue), assignmentMidterm(input.url, midtermDue)],
            headers,
          );
        }
        if (id === COURSE_102) {
          return json(
            200,
            [
              {
                id: 20,
                name: "Project 1",
                due_at: dueInDays(5, now),
                points_possible: 100,
                submission_types: ["online_upload"],
                html_url: html(input.url, `/courses/${COURSE_102}/assignments/20`),
                description: "<p>Implement a heap.</p>",
                course_id: COURSE_102,
              },
            ],
            headers,
          );
        }
        return json(200, [], headers);
      }
      if (resource === "assignment_groups") {
        return json(
          200,
          [
            { id: 1, name: "Homework", group_weight: 40 },
            { id: 2, name: "Exams", group_weight: 50 },
          ],
          headers,
        );
      }
    }

    const pageOne = /^\/api\/v1\/courses\/(\d+)\/pages\/([^/]+)$/.exec(path);
    if (pageOne) {
      const slug = decodeURIComponent(pageOne[2]);
      if (slug === "welcome") {
        return json(200, frontPage(input.url), headers);
      }
      if (slug === "week-3-reading") {
        return json(200, pageReading(input.url, true), headers);
      }
      if (slug === "syllabus") {
        return json(200, pageSyllabus(input.url, true), headers);
      }
      return json(404, { message: "page not found" }, headers);
    }

    const fileOne = /^\/api\/v1\/files\/(\d+)$/.exec(path);
    if (fileOne && Number(fileOne[1]) === FILE_LEC07) {
      return json(200, fileLec07(input.url), headers);
    }

    return json(404, { message: `no fixture for ${path}` }, headers);
  };

  const fetchFn: FetchLike = async (url, init) => {
    const u = new URL(url);
    const authorization =
      headerOf(init?.headers, "authorization") ?? headerOf(init?.headers, "Authorization") ?? "";
    const result = handleRequest({ url: u, authorization });
    const body = typeof result.body === "string" ? result.body : result.body;
    return new Response(body, { status: result.status, headers: result.headers });
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    try {
      const host = req.headers.host ?? "127.0.0.1";
      const u = new URL(req.url ?? "/", `http://${host}`);
      const result = handleRequest({
        url: u,
        authorization: String(req.headers.authorization ?? ""),
      });
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } catch {
      res.writeHead(500);
      res.end();
    }
  };

  return { fetch: fetchFn, pdf, handle };
}

export type FakeCanvasServer = {
  baseUrl: string;
  close: () => Promise<void>;
  fetch: FetchLike;
  pdf: Buffer;
};

export async function serveFakeCanvas(opts: FakeCanvasOptions = {}): Promise<FakeCanvasServer> {
  const fake = await createFakeCanvas(opts);
  const server: Server = createServer(fake.handle);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("fake canvas did not bind");
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const fetchThroughServer: FetchLike = async (url, init) => {
    const rewritten = rewriteOrigin(url, baseUrl);
    return fetch(rewritten, init);
  };
  return {
    baseUrl,
    fetch: fetchThroughServer,
    pdf: fake.pdf,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function rewriteOrigin(url: string, baseUrl: string): string {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    u.protocol = b.protocol;
    u.host = b.host;
    return u.href;
  } catch {
    return url;
  }
}

function bearer(header: string): string {
  const m = /^Bearer\s+(\S+)/i.exec(header.trim());
  return m?.[1] ?? "";
}

function headerOf(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return hit?.[1];
  }
  const rec = headers as Record<string, string>;
  for (const [k, v] of Object.entries(rec)) {
    if (k.toLowerCase() === name.toLowerCase()) {
      return v;
    }
  }
  return undefined;
}

function originOf(url: URL): string {
  return url.origin;
}

function html(url: URL, path: string): string {
  return `${url.origin}${path}`;
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string>,
): { status: number; headers: Record<string, string>; body: string } {
  return { status, headers, body: JSON.stringify(body) };
}

function course101(url: URL) {
  return {
    id: COURSE_101,
    name: "EECS 376",
    course_code: "EECS376",
    term: { name: "Fall 2026" },
    html_url: html(url, `/courses/${COURSE_101}`),
  };
}

function course102(url: URL) {
  return {
    id: COURSE_102,
    name: "EECS 281",
    course_code: "EECS281",
    term: { name: "Fall 2026" },
    html_url: html(url, `/courses/${COURSE_102}`),
  };
}

function frontPage(url: URL) {
  return {
    url: "welcome",
    title: "Welcome",
    body: '<h1>Welcome</h1><h2 id="pumping-lemma">Pumping lemma</h2><p>Pumping lemma web notes from the Canvas front page.</p>',
    html_url: html(url, `/courses/${COURSE_101}/pages/welcome`),
    updated_at: "2026-09-01T00:00:00Z",
    front_page: true,
  };
}

function pageWelcome(url: URL, withBody: boolean) {
  const page = frontPage(url);
  if (!withBody) {
    const { body: _b, ...rest } = page;
    return rest;
  }
  return page;
}

function pageReading(url: URL, withBody: boolean) {
  return {
    url: "week-3-reading",
    title: "Week 3 reading",
    body: withBody
      ? "<h1>Week 3</h1><p>Read the pumping lemma proof that a regular language must satisfy the length condition.</p>"
      : undefined,
    html_url: html(url, `/courses/${COURSE_101}/pages/week-3-reading`),
    updated_at: "2026-09-08T00:00:00Z",
  };
}

function pageSyllabus(url: URL, withBody: boolean) {
  return {
    url: "syllabus",
    title: "Syllabus",
    body: withBody
      ? "<h1>Syllabus</h1><p>Midterm on 2026-10-28. Office hours in Beyster.</p>"
      : undefined,
    html_url: html(url, `/courses/${COURSE_101}/pages/syllabus`),
    updated_at: "2026-08-20T00:00:00Z",
  };
}

function fileLec07(url: URL) {
  return {
    id: FILE_LEC07,
    display_name: "lec07.pdf",
    filename: "lec07.pdf",
    url: html(url, "/files/55/download"),
    html_url: html(url, `/courses/${COURSE_101}/files/${FILE_LEC07}`),
    content_type: "application/pdf",
    updated_at: "2026-09-10T00:00:00Z",
    size: 12_000,
  };
}

function assignmentHw(url: URL, due: string) {
  return {
    id: 9,
    name: "Homework 1",
    due_at: due,
    points_possible: 20,
    submission_types: ["online_upload"],
    html_url: html(url, `/courses/${COURSE_101}/assignments/9`),
    description: "<p>Practice the pumping lemma on the homework problems.</p>",
    assignment_group_id: 1,
    course_id: COURSE_101,
  };
}

function assignmentMidterm(url: URL, due: string) {
  return {
    id: 11,
    name: "Midterm Exam",
    due_at: due,
    points_possible: 100,
    submission_types: ["on_paper"],
    html_url: html(url, `/courses/${COURSE_101}/assignments/11`),
    description: "<p>In-class midterm covering lectures 1–7.</p>",
    assignment_group_id: 2,
    course_id: COURSE_101,
  };
}

function modules(url: URL, courseId: number) {
  if (courseId !== COURSE_101) {
    return [];
  }
  return [
    {
      id: 3,
      name: "Week 3",
      state: "unlocked",
      items: [
        {
          id: 31,
          title: "Week 3 reading",
          type: "Page",
          html_url: html(url, `/courses/${COURSE_101}/pages/week-3-reading`),
          page_url: "week-3-reading",
        },
        {
          id: 32,
          title: "lec07.pdf",
          type: "File",
          html_url: html(url, `/courses/${COURSE_101}/files/${FILE_LEC07}`),
          content_id: FILE_LEC07,
        },
        {
          id: 33,
          title: "Homework 1",
          type: "Assignment",
          html_url: html(url, `/courses/${COURSE_101}/assignments/9`),
          content_id: 9,
        },
        {
          id: 34,
          title: "Lecture capture",
          type: "ExternalTool",
          html_url: html(url, `/courses/${COURSE_101}/external_tools/1`),
        },
        {
          id: 35,
          title: "Locked notes",
          type: "File",
          html_url: html(url, `/courses/${COURSE_101}/files/99`),
          content_id: 99,
          content_details: { locked: true },
        },
      ],
    },
    {
      id: 4,
      name: "Hidden unit",
      state: "locked",
      items: [
        {
          id: 41,
          title: "Secret",
          type: "Page",
          html_url: html(url, `/courses/${COURSE_101}/pages/secret`),
        },
      ],
    },
  ];
}
