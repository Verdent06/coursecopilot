import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertIndexInSync,
  loadStarterPacks,
  packRawUrl,
  packSchemaPath,
} from "../../src/packs/catalog.js";
import { DEFAULT_PACK_RAW_BASE, DEFAULT_REGISTRY_URL } from "../../src/packs/schema.js";

describe("in-repo pack registry", () => {
  it("defaults to the coursecopilot repo packs/index.json", () => {
    expect(DEFAULT_REGISTRY_URL).toBe(
      "https://raw.githubusercontent.com/Verdent06/coursecopilot/main/packs/index.json",
    );
    expect(DEFAULT_PACK_RAW_BASE).toBe(
      "https://raw.githubusercontent.com/Verdent06/coursecopilot/main/packs",
    );
    expect(packRawUrl("harvard-cs50x")).toBe(`${DEFAULT_PACK_RAW_BASE}/harvard-cs50x.json`);
  });

  it("ships 10–20 starter packs that validate and match index.json", () => {
    const packs = loadStarterPacks();
    expect(packs.length).toBeGreaterThanOrEqual(10);
    expect(packs.length).toBeLessThanOrEqual(20);
    const ids = packs.map((p) => p.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    const index = assertIndexInSync();
    expect(index.packs.map((p) => p.id).sort()).toEqual([...ids].sort());
    for (const entry of index.packs) {
      expect(entry.url).toBe(packRawUrl(entry.id));
      expect(entry.source_count).toBeGreaterThan(0);
    }
  });

  it("keeps the JSON Schema file as the public contract", () => {
    const schema = JSON.parse(readFileSync(packSchemaPath(), "utf8")) as {
      $schema?: string;
      required?: string[];
    };
    expect(schema.$schema).toContain("2020-12");
    expect(schema.required).toEqual(["schema", "id", "name", "version", "sources"]);
  });

  it("points EECS 376 only at public pages and placeholders for leccap/Canvas", () => {
    const pack = loadStarterPacks().find((p) => p.manifest.id === "umich-eecs376");
    expect(pack).toBeTruthy();
    const urls = pack?.manifest.sources.map((s) => s.url) ?? [];
    expect(urls.some((u) => u.includes("eecs376.org"))).toBe(true);
    expect(urls.every((u) => !/leccap|instructure|canvas/i.test(u))).toBe(true);
    const kinds = new Set((pack?.manifest.connect_yourself ?? []).map((c) => c.kind));
    expect(kinds.has("lecture_capture")).toBe(true);
    expect(kinds.has("canvas")).toBe(true);
  });
});
