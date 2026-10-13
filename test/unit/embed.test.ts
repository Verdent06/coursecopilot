import { describe, expect, it } from "vitest";
import { hashEmbed } from "../../src/ingest/embed.js";
import { EMBED_DIM } from "../../src/retrieve/config.js";

describe("hashEmbed stub", () => {
  it("returns a unit 384-vector and is sensitive to tokens", () => {
    const a = hashEmbed("pumping lemma proof");
    const b = hashEmbed("pumping lemma proof");
    const c = hashEmbed("office hours in Beyster");
    expect(a.length).toBe(EMBED_DIM);
    expect(Math.abs(dot(a, a) - 1)).toBeLessThan(1e-5);
    expect(dot(a, b)).toBeCloseTo(1);
    expect(dot(a, c)).toBeLessThan(dot(a, b));
  });
});

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return s;
}
