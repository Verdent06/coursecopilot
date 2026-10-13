import { describe, expect, it } from "vitest";
import { extractPptx } from "../../src/ingest/sources/pptx.js";
import { buildSimplePptx } from "../helpers/sample-files.js";

describe("PPTX extractor", () => {
  it("extracts slide text, notes, titles, and 1-based slide locators", async () => {
    const buf = await buildSimplePptx([
      {
        title: "Pumping Lemma",
        body: "A method to prove languages are not regular",
        notes: "Walk through the lemma hypotheses first",
      },
      { title: "Proof idea", body: "Pick a string that cannot be pumped" },
    ]);
    const doc = await extractPptx(new Uint8Array(buf), "file:///tmp/lec07.pptx", "/tmp/lec07.pptx");
    expect(doc.meta.slide_count).toBe(2);
    expect(doc.segments).toHaveLength(2);
    expect(doc.segments[0]?.locator.slide).toBe(1);
    expect(doc.segments[0]?.locator.title).toBe("Pumping Lemma");
    expect(doc.segments[0]?.text).toMatch(/Pumping Lemma/);
    expect(doc.segments[0]?.text).toMatch(/Notes: Walk through the lemma/);
    expect(doc.segments[1]?.locator.slide).toBe(2);
    expect(doc.segments[1]?.text).toMatch(/Proof idea/);
  });
});
