import { describe, expect, it } from "vitest";
import { extractPdf } from "../../src/ingest/sources/pdf.js";
import { buildSimplePdf } from "../helpers/sample-files.js";

describe("PDF extractor", () => {
  it("extracts per-page text and 1-based page locators", async () => {
    const bytes = new Uint8Array(
      buildSimplePdf(["Lecture 7: Nonregular languages", "The pumping lemma on page two"]),
    );
    const doc = await extractPdf(bytes, "file:///tmp/lec07.pdf", "/tmp/lec07.pdf");
    expect(doc.mime).toContain("pdf");
    expect(doc.meta.page_count).toBe(2);
    expect(doc.meta.needs_ocr).toBe(false);
    expect(doc.segments).toHaveLength(2);
    expect(doc.segments[0]?.locator.page).toBe(1);
    expect(doc.segments[1]?.locator.page).toBe(2);
    expect(doc.segments[0]?.text).toMatch(/Lecture 7/);
    expect(doc.segments[1]?.text).toMatch(/pumping lemma/);
    expect(doc.segments[0]?.locator.path).toBe("file:///tmp/lec07.pdf");
  });

  it("marks landscape PDFs as slide decks with slide locators", async () => {
    const bytes = new Uint8Array(
      buildSimplePdf(["Slide title: Pumping lemma", "Proof on the next slide"], {
        landscape: true,
      }),
    );
    const doc = await extractPdf(bytes, "file:///tmp/deck.pdf", "/tmp/deck.pdf");
    expect(doc.meta.as_slides).toBe(true);
    expect(doc.segments[0]?.locator.slide).toBe(1);
    expect(doc.segments[0]?.headingPath).toMatch(/^Slide /);
  });

  it("flags needs_ocr when most pages are nearly empty", async () => {
    const bytes = new Uint8Array(buildSimplePdf(["ab", "cd"]));
    const doc = await extractPdf(bytes, "file:///tmp/scan.pdf", "/tmp/scan.pdf");
    expect(doc.meta.needs_ocr).toBe(true);
  });
});
