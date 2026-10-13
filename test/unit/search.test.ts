import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { disabledEmbedder, hashEmbedder } from "../../src/ingest/embed.js";
import { ingestFileSource } from "../../src/ingest/sources/file.js";
import { HybridSearch } from "../../src/retrieve/hybrid.js";
import { openMemory } from "../helpers/memory-db.js";
import { writeSampleFolder } from "../helpers/sample-files.js";

describe("hybrid search", () => {
  const temps: string[] = [];
  const closers: Array<() => void> = [];

  afterEach(() => {
    for (const close of closers.splice(0)) {
      close();
    }
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function seed(embedder = hashEmbedder()) {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", term: "F26", course_id: "eecs376-f26" });
    const dir = mkdtempSync(join(tmpdir(), "cc-search-"));
    temps.push(dir);
    const sample = await writeSampleFolder(dir);
    const source = repo.insertSource({
      id: "src1",
      course_id: "eecs376-f26",
      kind: "folder",
      uri: sample.dir,
    });
    await ingestFileSource({ repo, allowLocalPaths: true }, source.id);
    const chunks = repo.listChunksForSource(source.id);
    const vectors = await embedder.embed(chunks.map((c) => c.text));
    if (vectors && opened.vecEnabled) {
      repo.insertEmbeddings(
        chunks.map((c, i) => ({
          id: c.id,
          embedding: vectors[i] as Float32Array,
          course_id: c.course_id,
        })),
      );
    }
    const search = new HybridSearch(repo, embedder, opened.vecEnabled);
    return { repo, search, opened, sample };
  }

  it("golden: pumping lemma proof retrieves lec07 page/slide 14 as top-1", async () => {
    const { search } = await seed();
    const result = await search.search({
      query: "pumping lemma proof that a^n b^n is not regular",
      course_id: "eecs376-f26",
      k: 5,
    });
    expect(result.results.length).toBeGreaterThan(0);
    const top = result.results[0];
    expect(top?.citation.page).toBe(14);
    expect(top?.citation.slide).toBe(14);
    expect(top?.citation.kind).toBe("pdf");
    expect(top?.citation.label).toMatch(/slide 14/i);
    expect(top?.citation.url).toMatch(/#page=14$/);
    expect(top?.text).toMatch(/a\^n b\^n is not regular/i);
  });

  it("falls back to FTS-only with degraded: keyword_only", async () => {
    const { search } = await seed(disabledEmbedder());
    const result = await search.search({
      query: "pumping lemma proof that a^n b^n is not regular",
      k: 5,
    });
    expect(result.degraded).toBe("keyword_only");
    expect(result.results[0]?.citation.page).toBe(14);
  });

  it("get_chunk returns neighbors and get_document concatenates text", async () => {
    const { search, repo } = await seed();
    const result = await search.search({ query: "office hours", k: 3 });
    const hit = result.results.find((r) => /office hours/i.test(r.text));
    expect(hit).toBeTruthy();
    const chunk = search.getChunk(hit?.chunk_id ?? 0, 1);
    expect(chunk.chunk.text).toMatch(/office hours/i);
    expect(chunk.citation.label).toBeTruthy();

    const docs = repo.listChunksForCourse("eecs376-f26");
    const pdfChunk = docs.find(
      (c) => (JSON.parse(c.locator_json) as { page?: number }).page === 14,
    );
    expect(pdfChunk).toBeTruthy();
    const document = search.getDocument(pdfChunk?.document_id ?? "");
    expect(document.chunks.length).toBeGreaterThanOrEqual(14);
    expect(document.text).toMatch(/a\^n b\^n is not regular/i);
    expect(document.chunks.some((c) => c.citation.slide === 14)).toBe(true);
  });

  it("omitted course_id works with a single course and errors with many", async () => {
    const { search, repo } = await seed();
    const one = await search.search({ query: "pumping lemma", k: 1 });
    expect(one.results.length).toBeGreaterThan(0);
    repo.addCourse({ title: "Other", course_id: "other" });
    await expect(search.search({ query: "pumping lemma" })).rejects.toThrow(
      /course_id is required/,
    );
  });
});
