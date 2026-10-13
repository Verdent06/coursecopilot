import { describe, expect, it } from "vitest";
import {
  extractHtml,
  looksLikeLoginHtml,
  slugify,
  splitHtmlSections,
  suggestExams,
} from "../../src/ingest/sources/html.js";

describe("HTML extraction", () => {
  it("splits h2 sections and keeps heading ids as anchors", () => {
    const html = `<html><head><title>Notes</title></head><body>
      <h1>Lecture 7 notes</h1>
      <h2 id="pumping-lemma">Pumping Lemma</h2>
      <p>These pumping lemma web notes explain nonregular languages.</p>
      <h2 id="dfa-review">DFA review</h2>
      <p>Deterministic finite automata.</p>
    </body></html>`;
    const doc = extractHtml(html, "https://eecs376.org/notes.html");
    expect(doc.segments.length).toBeGreaterThanOrEqual(2);
    const pumping = doc.segments.find((s) => s.locator.anchor === "pumping-lemma");
    expect(pumping?.text).toMatch(/pumping lemma web notes/i);
    expect(pumping?.headingPath).toMatch(/Pumping Lemma/);
  });

  it("keeps schedule tables as markdown and suggests exams", () => {
    const html = `<html><body>
      <h1>Schedule</h1>
      <table>
        <tr><th>Event</th><th>Date</th></tr>
        <tr><td>Midterm</td><td>October 28, 2026</td></tr>
      </table>
    </body></html>`;
    const doc = extractHtml(html, "https://eecs376.org/schedule.html");
    const text = doc.segments.map((s) => s.text).join("\n");
    expect(text).toMatch(/Midterm/);
    expect(text).toMatch(/\|/);
    const exams = suggestExams(text);
    expect(exams.some((e) => e.name === "Midterm" && e.date === "2026-10-28")).toBe(true);
  });

  it("detects login pages", () => {
    expect(looksLikeLoginHtml('<form><input type="password" name="pw"></form>')).toBe(true);
    expect(looksLikeLoginHtml("<p>No form here</p>")).toBe(false);
  });

  it("slugifies heading text", () => {
    expect(slugify("Pumping Lemma")).toBe("pumping-lemma");
  });

  it("splits nested content without dropping the first heading", () => {
    const sections = splitHtmlSections(
      '<h2 id="a">A</h2><p>one</p><h3 id="b">B</h3><p>two</p>',
      "Page",
    );
    expect(sections.some((s) => s.anchor === "a")).toBe(true);
    expect(sections.some((s) => s.anchor === "b")).toBe(true);
  });
});
