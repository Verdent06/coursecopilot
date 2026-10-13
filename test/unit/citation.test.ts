import { describe, expect, it } from "vitest";
import { MIME_PDF, MIME_PPTX } from "../../src/ingest/mime.js";
import { buildCitation, isSlideDeckPdf } from "../../src/retrieve/citation.js";

const base = {
  chunk_id: 4812,
  document_id: "doc1",
  source_id: "src1",
  course_title: "EECS 376",
};

describe("citations", () => {
  it("labels a regular PDF as p. N with #page=N", () => {
    const c = buildCitation({
      ...base,
      source_kind: "file",
      mime: MIME_PDF,
      doc_title: "Lecture 7: Nonregular languages",
      doc_url: "https://eecs376.org/lec07.pdf",
      heading_path: "Page 14",
      locator: { url: "https://eecs376.org/lec07.pdf", page: 14 },
    });
    expect(c.kind).toBe("pdf");
    expect(c.page).toBe(14);
    expect(c.slide).toBeNull();
    expect(c.label).toContain("p. 14");
    expect(c.url).toBe("https://eecs376.org/lec07.pdf#page=14");
  });

  it("labels a slide-deck PDF as slide N", () => {
    const c = buildCitation({
      ...base,
      source_kind: "file",
      mime: MIME_PDF,
      doc_title: "Lecture 7 slides",
      doc_url: "file:///tmp/lec07.pdf",
      heading_path: "Slide 14",
      locator: { path: "file:///tmp/lec07.pdf", page: 14, slide: 14 },
      meta: { as_slides: true },
    });
    expect(c.kind).toBe("pdf");
    expect(c.slide).toBe(14);
    expect(c.page).toBe(14);
    expect(c.label).toMatch(/slide 14/i);
    expect(c.label).not.toMatch(/p\. 14/);
    expect(c.url).toContain("#page=14");
  });

  it("labels PPTX as slide N without a deep link", () => {
    const c = buildCitation({
      ...base,
      source_kind: "file",
      mime: MIME_PPTX,
      doc_title: "Pumping Lemma",
      doc_url: "file:///tmp/lec07.pptx",
      heading_path: "Slide 2 > Proof idea",
      locator: { path: "file:///tmp/lec07.pptx", slide: 2, title: "Proof idea" },
    });
    expect(c.kind).toBe("pptx");
    expect(c.slide).toBe(2);
    expect(c.label).toMatch(/slide 2/i);
    expect(c.url).toBe("file:///tmp/lec07.pptx");
  });

  it("labels web, youtube, canvas, and local files", () => {
    const web = buildCitation({
      ...base,
      source_kind: "website",
      mime: "text/html",
      doc_title: "Lecture notes",
      doc_url: "https://example.edu/lec",
      heading_path: "Lecture 7 > Pumping Lemma",
      locator: { url: "https://example.edu/lec", anchor: "pumping" },
    });
    expect(web.kind).toBe("web");
    expect(web.url).toBe("https://example.edu/lec#pumping");
    expect(web.label).toContain("Pumping Lemma");

    const webPdf = buildCitation({
      ...base,
      source_kind: "website",
      mime: MIME_PDF,
      doc_title: "Lecture 7: Nonregular languages",
      doc_url: "https://eecs376.org/lec07.pdf",
      heading_path: "Page 14",
      locator: { url: "https://eecs376.org/lec07.pdf", page: 14 },
    });
    expect(webPdf.kind).toBe("pdf");
    expect(webPdf.url).toBe("https://eecs376.org/lec07.pdf#page=14");

    const yt = buildCitation({
      ...base,
      source_kind: "youtube",
      mime: "text/vtt",
      doc_title: "Lecture 7",
      doc_url: "https://www.youtube.com/watch?v=abcdefghijk",
      heading_path: null,
      locator: { url: "https://www.youtube.com/watch?v=abcdefghijk", start_s: 125, end_s: 180 },
    });
    expect(yt.kind).toBe("youtube");
    expect(yt.label).toContain("2:05");
    expect(yt.url).toBe("https://youtu.be/abcdefghijk?t=125s");

    const ytId = buildCitation({
      ...base,
      source_kind: "youtube",
      mime: "text/vtt",
      doc_title: "Lecture 7",
      doc_url: null,
      heading_path: null,
      locator: { video_id: "abcdefghijk", start_s: 90, end_s: 120 },
    });
    expect(ytId.url).toBe("https://youtu.be/abcdefghijk?t=90s");
    expect(ytId.label).toContain("1:30");

    const canvas = buildCitation({
      ...base,
      source_kind: "canvas",
      mime: "text/html",
      doc_title: "Module 3 reading",
      doc_url: "https://umich.instructure.com/courses/1/pages/x",
      heading_path: null,
      locator: { url: "https://umich.instructure.com/courses/1/pages/x", title: "Week 3" },
    });
    expect(canvas.kind).toBe("canvas");
    expect(canvas.label).toMatch(/^\[Canvas · /);

    const file = buildCitation({
      ...base,
      source_kind: "file",
      mime: "text/plain",
      doc_title: "office-hours.txt",
      doc_url: "file:///tmp/office-hours.txt",
      heading_path: "office-hours.txt",
      locator: { path: "file:///tmp/office-hours.txt" },
    });
    expect(file.kind).toBe("file");
    expect(file.url).toBe("file:///tmp/office-hours.txt");
  });

  it("treats locator.slide or meta.as_slides as a slide deck", () => {
    expect(isSlideDeckPdf({ locator: { slide: 1 }, meta: {} })).toBe(true);
    expect(isSlideDeckPdf({ locator: { page: 1 }, meta: { as_slides: true } })).toBe(true);
    expect(isSlideDeckPdf({ locator: { page: 1 }, meta: {} })).toBe(false);
  });
});
