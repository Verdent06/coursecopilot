import { describe, expect, it } from "vitest";
import { allocateProportional, buildStudyPlan, daysUntilExam } from "../../src/learn/planner.js";

const now = new Date("2026-10-13T12:00:00.000Z");

describe("study planner (spec §11)", () => {
  it("daysUntilExam is calendar days in UTC", () => {
    expect(daysUntilExam("2026-10-20", now)).toBe(7);
    expect(daysUntilExam("2026-10-13", now)).toBe(0);
  });

  it("allocateProportional is deterministic and honors the 15-minute floor", () => {
    const a = allocateProportional([0.85, 0.4], 420, 15);
    const b = allocateProportional([0.85, 0.4], 420, 15);
    expect(a).toEqual(b);
    expect(a.reduce((x, y) => x + y, 0)).toBe(420);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(15);
    expect(a[0]).toBeGreaterThan(a[1] ?? 0);
  });

  it("gives the weakest topic the most minutes, repeats on ceil(D/2) and D-1, last day exam_sim", () => {
    const plan = buildStudyPlan({
      topics: [
        { name: "Pumping lemma", weakness: 0.85, chunks: [] },
        { name: "Office hours", weakness: 0.4, chunks: [] },
      ],
      examName: "Midterm",
      examDate: "2026-10-20",
      minutesPerDay: 60,
      now,
    });
    expect(plan.days).toHaveLength(7);
    expect(plan.days[0]?.date).toBe("2026-10-13");
    expect(plan.days[6]?.date).toBe("2026-10-19");
    expect(
      plan.days[6]?.sessions.some((s) => s.activity === "practice" && s.topic === "mixed"),
    ).toBe(true);

    const minutes = (name: string) =>
      plan.days
        .flatMap((d) => d.sessions)
        .filter((s) => s.topic === name)
        .reduce((n, s) => n + s.minutes, 0);
    expect(minutes("Pumping lemma")).toBeGreaterThan(minutes("Office hours"));

    const dayNum = (iso: string) =>
      Math.round(
        (Date.parse(`${iso}T00:00:00Z`) - Date.parse("2026-10-13T00:00:00Z")) / 86_400_000,
      ) + 1;
    const repeatDays = plan.days
      .filter((d) => d.sessions.some((s) => s.activity === "review" && s.topic === "Pumping lemma"))
      .map((d) => dayNum(d.date));
    expect(repeatDays).toContain(Math.ceil(7 / 2));
    expect(repeatDays).toContain(6);

    expect(plan.rationale).toMatch(/Midterm on 2026-10-20/);
    expect(plan.rationale).toMatch(/Pumping lemma/);
  });

  it("defaults to 7 days when no exam is set", () => {
    const plan = buildStudyPlan({
      topics: [{ name: "A", weakness: 1, chunks: [] }],
      minutesPerDay: 60,
      now,
    });
    expect(plan.days).toHaveLength(7);
    expect(plan.rationale).toMatch(/no exam set/i);
  });

  it("is deterministic across calls", () => {
    const input = {
      topics: [
        { name: "B", weakness: 0.5, chunks: [] },
        { name: "A", weakness: 0.5, chunks: [] },
      ],
      examDate: "2026-10-20",
      minutesPerDay: 60,
      now,
    };
    expect(buildStudyPlan(input)).toEqual(buildStudyPlan(input));
  });
});
