import { afterEach, describe, expect, it } from "vitest";
import { RepoError } from "../../src/db/repo.js";
import { openMemory } from "../helpers/memory-db.js";

describe("CourseRepo", () => {
  let close: (() => void) | undefined;

  afterEach(() => {
    close?.();
    close = undefined;
  });

  it("add_course generates a slug and list_courses returns empty counts", () => {
    const { opened, repo } = openMemory();
    close = () => opened.db.close();

    const created = repo.addCourse({ title: "EECS 376", term: "F26" });
    expect(created.course_id).toBe("eecs-376-f26");

    const list = repo.listCourses();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      course_id: "eecs-376-f26",
      title: "EECS 376",
      term: "F26",
      source_count: 0,
      chunk_count: 0,
      exams: [],
    });
  });

  it("honors an explicit course_id and rejects duplicates", () => {
    const { opened, repo } = openMemory();
    close = () => opened.db.close();

    expect(repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" }).course_id).toBe(
      "eecs376-f26",
    );
    expect(() => repo.addCourse({ title: "Other", course_id: "eecs376-f26" })).toThrow(RepoError);
  });

  it("suffixes generated slugs on collision", () => {
    const { opened, repo } = openMemory();
    close = () => opened.db.close();

    expect(repo.addCourse({ title: "Algo" }).course_id).toBe("algo");
    expect(repo.addCourse({ title: "Algo" }).course_id).toBe("algo-2");
  });

  it("set_exam inserts, replaces by name, and errors on unknown course", () => {
    const { opened, repo } = openMemory();
    close = () => opened.db.close();

    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });

    const first = repo.setExam({
      course_id: "eecs376-f26",
      name: "Midterm",
      date: "2026-10-28",
      topics: ["Pumping lemma"],
      weight: 0.25,
    });
    expect(first.exams).toEqual([
      { name: "Midterm", date: "2026-10-28", topics: ["Pumping lemma"], weight: 0.25 },
    ]);

    const replaced = repo.setExam({
      course_id: "eecs376-f26",
      name: "midterm",
      date: "2026-11-04",
      weight: 0.3,
    });
    expect(replaced.exams).toHaveLength(1);
    expect(replaced.exams[0]?.date).toBe("2026-11-04");
    expect(replaced.exams[0]?.weight).toBe(0.3);

    const listed = repo.listCourses()[0];
    expect(listed?.exams[0]?.date).toBe("2026-11-04");

    expect(() => repo.setExam({ course_id: "missing", name: "Final", date: "2026-12-14" })).toThrow(
      /Valid ids: eecs376-f26/,
    );
  });

  it("rejects invalid exam dates", () => {
    const { opened, repo } = openMemory();
    close = () => opened.db.close();
    repo.addCourse({ title: "X", course_id: "x" });
    expect(() => repo.setExam({ course_id: "x", name: "Midterm", date: "10/28/2026" })).toThrow(
      /YYYY-MM-DD/,
    );
  });
});
