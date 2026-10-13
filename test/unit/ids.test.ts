import { describe, expect, it } from "vitest";
import { isValidCourseId, nextAvailableSlug, slugifyCourseId } from "../../src/util/ids.js";

describe("slugifyCourseId", () => {
  it("kebab-cases a title and appends term", () => {
    expect(slugifyCourseId("EECS 376", "F26")).toBe("eecs-376-f26");
  });

  it("does not double-append a term already in the title", () => {
    expect(slugifyCourseId("EECS 376 F26", "F26")).toBe("eecs-376-f26");
  });

  it("falls back to 'course' for empty punctuation", () => {
    expect(slugifyCourseId("???")).toBe("course");
  });
});

describe("isValidCourseId", () => {
  it("accepts the spec example slug", () => {
    expect(isValidCourseId("eecs376-f26")).toBe(true);
  });

  it("rejects uppercase and spaces", () => {
    expect(isValidCourseId("EECS376")).toBe(false);
    expect(isValidCourseId("eecs 376")).toBe(false);
  });
});

describe("nextAvailableSlug", () => {
  it("returns the base when free", () => {
    expect(nextAvailableSlug("eecs-376-f26", () => false)).toBe("eecs-376-f26");
  });

  it("suffixes -2, -3 on collision", () => {
    const taken = new Set(["algo", "algo-2"]);
    expect(nextAvailableSlug("algo", (id) => taken.has(id))).toBe("algo-3");
  });
});
