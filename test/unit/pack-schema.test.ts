import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PackError, parsePackDocument, validatePackManifest } from "../../src/packs/schema.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/packs");

describe("pack schema", () => {
  it("accepts the JSON fixture", () => {
    const manifest = parsePackDocument(readFileSync(join(dir, "mini.json"), "utf8"), "mini.json");
    expect(manifest.id).toBe("mini");
    expect(manifest.sources).toHaveLength(2);
    expect(manifest.topics?.[0]?.topics).toContain("Pumping lemma");
  });

  it("accepts the YAML fixture", () => {
    const manifest = parsePackDocument(
      readFileSync(join(dir, "mini.yaml"), "utf8"),
      "mini-yaml.yaml",
    );
    expect(manifest.id).toBe("mini-yaml");
    expect(manifest.sources.map((s) => s.kind)).toEqual([
      "website",
      "pdf",
      "youtube",
      "transcript",
    ]);
    expect(manifest.sources[1]?.lecture).toBe(7);
  });

  it("rejects embedded lecture text", () => {
    expect(() =>
      parsePackDocument(
        readFileSync(join(dir, "invalid-content.json"), "utf8"),
        "invalid-content.json",
      ),
    ).toThrow(/embed course content/i);
  });

  it("rejects file:// and other non-http URLs", () => {
    expect(() =>
      parsePackDocument(
        readFileSync(join(dir, "invalid-file-url.json"), "utf8"),
        "invalid-file-url.json",
      ),
    ).toThrow(/http\(s\)/i);
  });

  it("requires id to match the filename stem", () => {
    expect(() =>
      parsePackDocument(readFileSync(join(dir, "wrong-id.json"), "utf8"), "wrong-id.json"),
    ).toThrow(/must match the filename/i);
  });

  it("rejects more than 500 sources", () => {
    const sources = Array.from({ length: 501 }, (_, i) => ({
      kind: "website" as const,
      url: `https://example.edu/p/${i}`,
    }));
    expect(() =>
      validatePackManifest({
        schema: 1,
        id: "too-big",
        name: "Too many",
        version: "1.0.0",
        sources,
      }),
    ).toThrow(PackError);
  });

  it("rejects a long base64 blob", () => {
    expect(() =>
      validatePackManifest({
        schema: 1,
        id: "blob",
        name: "Blob",
        version: "1.0.0",
        sources: [{ kind: "website", url: "https://example.edu/" }],
        extra: "A".repeat(200) + "B".repeat(200),
      }),
    ).toThrow(/embed/i);
  });
});
