import { afterEach, describe, expect, it } from "vitest";
import { TtlCache } from "../../src/canvas/cache.js";
import { CanvasClient } from "../../src/canvas/client.js";
import { CANVAS_ERROR } from "../../src/canvas/errors.js";
import {
  getLivePage,
  listLiveAnnouncements,
  listLiveAssignments,
  listLiveCourses,
  listLiveFiles,
  listLiveModules,
  listLivePages,
  openCanvas,
} from "../../src/canvas/tools.js";
import { COURSE_101, createFakeCanvas, VALID_TOKEN } from "../helpers/fake-canvas.js";
import { openMemory } from "../helpers/memory-db.js";

describe("Canvas live tools", () => {
  const closers: Array<() => void> = [];

  afterEach(() => {
    delete process.env.CANVAS_TOKEN;
    delete process.env.CANVAS_BASE_URL;
    for (const close of closers.splice(0)) {
      close();
    }
  });

  async function runtime() {
    const fake = await createFakeCanvas();
    const client = new CanvasClient({
      credentials: { baseUrl: "https://umich.instructure.com", token: VALID_TOKEN },
      fetchFn: fake.fetch,
      sleep: async () => undefined,
    });
    return { runtime: { client, cache: new TtlCache(30_000) }, fake };
  }

  it("lists courses with linked_course_id after a canvas source exists", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });
    repo.insertSource({
      id: "src",
      course_id: "eecs376-f26",
      kind: "canvas",
      uri: `canvas://course/${COURSE_101}`,
    });
    const { runtime: rt } = await runtime();
    const courses = await listLiveCourses(rt, repo, false);
    expect(courses.some((c) => c.canvas_course_id === String(COURSE_101))).toBe(true);
    expect(courses.find((c) => c.canvas_course_id === String(COURSE_101))?.linked_course_id).toBe(
      "eecs376-f26",
    );
  });

  it("lists modules, pages, files (403 fallback), assignments, announcements", async () => {
    const { runtime: rt } = await runtime();
    const modules = await listLiveModules(rt, String(COURSE_101));
    expect(modules.some((m) => m.module === "Week 3")).toBe(true);
    expect(modules.find((m) => m.module === "Week 3")?.items.some((i) => i.type === "File")).toBe(
      true,
    );

    const pages = await listLivePages(rt, String(COURSE_101), "week");
    expect(pages.some((p) => p.id === "week-3-reading")).toBe(true);

    const page = await getLivePage(rt, String(COURSE_101), "week-3-reading");
    expect(page.body_markdown).toMatch(/pumping lemma/i);

    const files = await listLiveFiles(rt, String(COURSE_101));
    expect(files.some((f) => f.title === "lec07.pdf")).toBe(true);

    const now = new Date("2026-10-13T12:00:00.000Z");
    const assignments = await listLiveAssignments(rt, {
      canvasCourseId: String(COURSE_101),
      upcomingOnly: true,
      days: 14,
      now,
    });
    expect(assignments.some((a) => a.name === "Homework 1")).toBe(true);
    expect(assignments.find((a) => a.name === "Homework 1")?.due_at).toBeTruthy();
    expect(assignments.find((a) => a.name === "Homework 1")?.due_at_local).toBeTruthy();

    const all = await listLiveAssignments(rt, { upcomingOnly: true, days: 14, now });
    expect(all.some((a) => a.course === "EECS 281")).toBe(true);

    const announcements = await listLiveAnnouncements(rt, {
      canvasCourseId: String(COURSE_101),
      sinceDays: 14,
      now,
    });
    expect(announcements.some((a) => /office hours/i.test(a.title))).toBe(true);
    expect(announcements[0]?.message_markdown).toMatch(/Beyster/i);
  });

  it("openCanvas reports canvas_not_configured without credentials", () => {
    delete process.env.CANVAS_TOKEN;
    delete process.env.CANVAS_BASE_URL;
    process.env.COURSECOPILOT_HOME = "/tmp/cc-no-secrets-canvas-test";
    const opened = openCanvas({});
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.error.error).toBe(CANVAS_ERROR.notConfigured);
      expect(opened.error.fallback).toMatch(/canvas connect/i);
    }
  });
});
