import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { saveCanvasIcsUrl } from "../../src/canvas/auth.js";
import { TtlCache } from "../../src/canvas/cache.js";
import { CanvasClient } from "../../src/canvas/client.js";
import { CANVAS_ERROR } from "../../src/canvas/errors.js";
import { saveCanvasSnapshot } from "../../src/canvas/snapshot.js";
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

  const homes: string[] = [];

  afterEach(() => {
    delete process.env.CANVAS_TOKEN;
    delete process.env.CANVAS_BASE_URL;
    delete process.env.CANVAS_ICS_URL;
    for (const close of closers.splice(0)) {
      close();
    }
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
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
      expect(opened.error.fallback).toMatch(/connect_canvas|canvas connect/i);
    }
  });

  it("lists assignments from an ICS feed when no token is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-ics-tools-"));
    homes.push(dir);
    process.env.COURSECOPILOT_HOME = dir;
    saveCanvasIcsUrl("https://umich.instructure.com/feeds/calendars/user_abc.ics");
    const ics = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../fixtures/canvas/calendar.ics"),
      "utf8",
    );
    const fetchFn = (async () =>
      new Response(ics, {
        status: 200,
        headers: { "content-type": "text/calendar" },
      })) as typeof fetch;
    const assignments = await listLiveAssignments(
      { fetchFn, cache: new TtlCache(30_000) },
      { upcomingOnly: true, days: 14, now: new Date("2026-10-13T12:00:00.000Z") },
    );
    expect(assignments.some((a) => a.name === "Homework 3" && a.course === "EECS 376")).toBe(true);
  });

  it("lists courses and pages from an extension snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-snap-tools-"));
    homes.push(dir);
    process.env.COURSECOPILOT_HOME = dir;
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    saveCanvasSnapshot({
      version: 1,
      synced_at: new Date().toISOString(),
      courses: [{ id: 101, name: "EECS 376", course_code: "EECS376" }],
      modules: { "101": [{ id: 1, name: "Week 1", items: [] }] },
      pages: {
        "101": [
          {
            url: "syllabus",
            title: "Syllabus",
            body: "<p>Office hours</p>",
            html_url: "https://umich.instructure.com/courses/101/pages/syllabus",
          },
        ],
      },
      files: { "101": [] },
      assignments: {
        "101": [
          {
            id: 9,
            name: "HW1",
            due_at: "2026-10-20T23:59:00Z",
            html_url: "https://umich.instructure.com/courses/101/assignments/9",
          },
        ],
      },
      announcements: [],
    });
    const courses = await listLiveCourses({}, repo, false);
    expect(courses.some((c) => c.canvas_course_id === "101")).toBe(true);
    const page = await getLivePage({}, "101", "syllabus");
    expect(page.body_markdown).toMatch(/Office hours/i);
    const due = await listLiveAssignments(
      {},
      { upcomingOnly: true, days: 14, now: new Date("2026-10-13T12:00:00.000Z") },
    );
    expect(due.some((a) => a.name === "HW1")).toBe(true);
  });
});
