import { describe, expect, it } from "vitest";
import { CanvasClient, parseLinkNext } from "../../src/canvas/client.js";
import { CANVAS_ERROR } from "../../src/canvas/errors.js";
import {
  BLOCKED_TOKEN,
  COURSE_101,
  COURSE_102,
  createFakeCanvas,
  EXPIRED_TOKEN,
  VALID_TOKEN,
} from "../helpers/fake-canvas.js";

function client(
  token: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  extras: { remaining?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  return new CanvasClient({
    credentials: { baseUrl: "https://umich.instructure.com", token },
    fetchFn,
    sleep: extras.sleep ?? (async () => undefined),
  });
}

describe("Canvas REST client", () => {
  it("paginates courses via Link rel=next", async () => {
    const fake = await createFakeCanvas();
    const c = client(VALID_TOKEN, fake.fetch);
    const courses = await c.listCourses();
    expect(courses.map((x) => x.id).sort()).toEqual([COURSE_101, COURSE_102]);
    expect(courses[0]?.term?.name).toBe("Fall 2026");
  });

  it("maps expired and blocked tokens on /users/self", async () => {
    const fake = await createFakeCanvas();
    await expect(client(EXPIRED_TOKEN, fake.fetch).getSelf()).rejects.toMatchObject({
      code: CANVAS_ERROR.tokenRejected,
      status: 401,
    });
    await expect(client(BLOCKED_TOKEN, fake.fetch).getSelf()).rejects.toMatchObject({
      code: CANVAS_ERROR.tokensBlocked,
      status: 403,
    });
    const self = await client(VALID_TOKEN, fake.fetch).getSelf();
    expect(self.name).toBe("Jane Student");
    expect(self.time_zone).toBe("America/Detroit");
  });

  it("falls back from 403 /files to module File items", async () => {
    const fake = await createFakeCanvas();
    const c = client(VALID_TOKEN, fake.fetch);
    const { files, via } = await c.listFiles(COURSE_101);
    expect(via).toBe("modules");
    expect(files.some((f) => f.display_name === "lec07.pdf")).toBe(true);
  });

  it("uses the files list when it is allowed", async () => {
    const fake = await createFakeCanvas({ allowFilesList: true });
    const c = client(VALID_TOKEN, fake.fetch);
    const { files, via } = await c.listFiles(COURSE_101);
    expect(via).toBe("files");
    expect(files).toHaveLength(1);
  });

  it("slows down when X-Rate-Limit-Remaining is below 50", async () => {
    const fake = await createFakeCanvas({ rateLimitRemaining: 10 });
    const sleeps: number[] = [];
    const c = client(VALID_TOKEN, fake.fetch, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await c.getSelf();
    await c.getSelf();
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  it("parses Link rel=next", () => {
    expect(
      parseLinkNext(
        '<https://umich.instructure.com/api/v1/courses?page=2>; rel="next", <https://umich.instructure.com/api/v1/courses?page=5>; rel="last"',
      ),
    ).toBe("https://umich.instructure.com/api/v1/courses?page=2");
    expect(parseLinkNext(null)).toBeNull();
  });
});
