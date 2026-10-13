import { describe, expect, it } from "vitest";
import { cosine, isGenericTopicName, normalizeTopicName } from "../../src/ingest/topics.js";

describe("topic heuristic helpers", () => {
  it("drops page/slide/filename generics", () => {
    expect(isGenericTopicName("Page 14")).toBe(true);
    expect(isGenericTopicName("Slide 2")).toBe(true);
    expect(isGenericTopicName("notes.md")).toBe(true);
    expect(isGenericTopicName("Pumping lemma")).toBe(false);
    expect(isGenericTopicName("DFA")).toBe(false);
    expect(isGenericTopicName("EECS 376", "EECS 376")).toBe(true);
  });

  it("normalizes whitespace", () => {
    expect(normalizeTopicName("  Pumping   lemma ")).toBe("Pumping lemma");
  });

  it("cosine of a vector with itself is 1 after L2 (unit vector)", () => {
    const v = new Float32Array([0.6, 0.8]);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
    expect(cosine(v, new Float32Array([0.8, -0.6]))).toBeCloseTo(0, 5);
  });
});
