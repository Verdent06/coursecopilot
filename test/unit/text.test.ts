import { describe, expect, it } from "vitest";
import {
  extractMarkdown,
  extractPlainText,
  splitMarkdownSections,
} from "../../src/ingest/sources/text.js";
import { SAMPLE_MD, SAMPLE_TXT } from "../helpers/sample-files.js";

describe("markdown / txt extractor", () => {
  it("splits markdown on h1–h3 and keeps heading_path", () => {
    const sections = splitMarkdownSections(SAMPLE_MD);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections.map((s) => s.headingPath)).toContain("Lecture 7");
    expect(sections.some((s) => s.headingPath.includes("Pumping Lemma"))).toBe(true);
    expect(sections.some((s) => s.headingPath.includes("Proof"))).toBe(true);
  });

  it("extractMarkdown stores a path locator", () => {
    const doc = extractMarkdown(SAMPLE_MD, "file:///tmp/notes.md", "/tmp/notes.md");
    expect(doc.title).toBe("Lecture 7");
    expect(doc.segments.every((s) => s.locator.path === "file:///tmp/notes.md")).toBe(true);
    expect(doc.segments.some((s) => /pumping lemma/i.test(s.text))).toBe(true);
  });

  it("extractPlainText keeps the whole file as one segment", () => {
    const doc = extractPlainText(SAMPLE_TXT, "file:///tmp/a.txt", "/tmp/a.txt", "text/plain");
    expect(doc.segments).toHaveLength(1);
    expect(doc.segments[0]?.text).toMatch(/Office hours/);
  });
});
