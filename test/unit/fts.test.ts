import { describe, expect, it } from "vitest";
import { ftsMatchQuery } from "../../src/retrieve/fts.js";

describe("ftsMatchQuery", () => {
  it("quotes tokens and ORs them", () => {
    expect(ftsMatchQuery("pumping lemma proof")).toBe('"pumping" OR "lemma" OR "proof"');
  });

  it("strips FTS operators and returns null when nothing remains", () => {
    expect(ftsMatchQuery("a^n b^n is not regular")).toContain('"is"');
    expect(ftsMatchQuery('"" **')).toBeNull();
  });
});
