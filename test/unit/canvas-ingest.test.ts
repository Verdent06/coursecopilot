import { afterEach, describe, expect, it } from "vitest";
import { CanvasClient } from "../../src/canvas/client.js";
import { hashEmbedder } from "../../src/ingest/embed.js";
import { IngestQueue } from "../../src/ingest/queue.js";
import { ingestCanvasSource } from "../../src/ingest/sources/canvas.js";
import { HybridSearch } from "../../src/retrieve/hybrid.js";
import { COURSE_101, createFakeCanvas, VALID_TOKEN } from "../helpers/fake-canvas.js";
import { openMemory } from "../helpers/memory-db.js";

describe("Canvas ingest", () => {
  const closers: Array<() => void> = [];

  afterEach(() => {
    for (const close of closers.splice(0)) {
      close();
    }
  });

  it("ingests front page, pages, files via modules, assignments, announcements; skips locked/LTI", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });
    const fake = await createFakeCanvas();
    const canvas = new CanvasClient({
      credentials: { baseUrl: "https://umich.instructure.com", token: VALID_TOKEN },
      fetchFn: fake.fetch,
      sleep: async () => undefined,
    });
    const source = repo.insertSource({
      id: "src-canvas",
      course_id: "eecs376-f26",
      kind: "canvas",
      uri: `canvas://course/${COURSE_101}`,
    });

    const result = await ingestCanvasSource({ repo, canvas }, source.id);
    expect(result.docs).toBeGreaterThanOrEqual(5);
    expect(result.errors).toBe(0);
    expect(result.skipped.some((s) => /VTT|transcript/i.test(s.reason))).toBe(true);
    expect(result.skipped.some((s) => /locked module/i.test(s.reason))).toBe(true);
    expect(result.skipped.some((s) => /403/.test(s.reason) || /module items/i.test(s.reason))).toBe(
      true,
    );
    expect(result.suggestedExams?.some((e) => /midterm/i.test(e.name))).toBe(true);

    const chunks = repo.listChunksForCourse("eecs376-f26");
    expect(chunks.some((c) => /pumping lemma web notes/i.test(c.text))).toBe(true);
    expect(chunks.some((c) => /office hours/i.test(c.text))).toBe(true);
    expect(chunks.some((c) => /homework/i.test(c.text))).toBe(true);

    const pdf = chunks.find((c) => {
      const loc = JSON.parse(c.locator_json) as { page?: number; canvas?: { item_type?: string } };
      return loc.page === 14 && loc.canvas?.item_type === "file";
    });
    expect(pdf).toBeTruthy();
    const pdfLoc = JSON.parse(pdf?.locator_json ?? "{}") as {
      url?: string;
      page?: number;
      canvas?: { course_id?: number; item_type?: string; module?: string };
    };
    expect(pdfLoc.canvas?.course_id).toBe(COURSE_101);
    expect(pdfLoc.canvas?.module).toBe("Week 3");
    expect(pdfLoc.url).toMatch(/\/files\/55/);

    const pageLoc = JSON.parse(
      chunks.find((c) => /pumping lemma web notes/i.test(c.text))?.locator_json ?? "{}",
    ) as { canvas?: { item_type?: string }; url?: string };
    expect(pageLoc.canvas?.item_type).toBe("page");

    const dump =
      JSON.stringify(opened.db.prepare("SELECT * FROM sources").all()) +
      JSON.stringify(opened.db.prepare("SELECT config_json FROM sources").all());
    expect(dump).not.toContain(VALID_TOKEN);
    expect(dump).not.toContain("Bearer");
  });

  it("queues through IngestQueue and search cites Canvas", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });
    const fake = await createFakeCanvas();
    const canvas = new CanvasClient({
      credentials: { baseUrl: "https://umich.instructure.com", token: VALID_TOKEN },
      fetchFn: fake.fetch,
      sleep: async () => undefined,
    });
    const source = repo.insertSource({
      id: "src-q",
      course_id: "eecs376-f26",
      kind: "canvas",
      uri: `canvas://course/${COURSE_101}`,
    });
    const embedder = hashEmbedder();
    const queue = new IngestQueue({ repo, canvas, embedder });
    const jobId = queue.submit(source.id);
    await queue.waitForIdle();
    const job = repo.getJob(jobId);
    expect(job?.state).toBe("done");
    expect(job?.message ?? "").toMatch(/Midterm/);

    const search = new HybridSearch(repo, embedder, opened.vecEnabled);
    const hits = await search.search({
      course_id: "eecs376-f26",
      query: "pumping lemma web notes",
      k: 5,
    });
    expect(hits.results.length).toBeGreaterThan(0);
    const cited = hits.results.find((r) => /Canvas/.test(r.citation.label));
    expect(cited?.citation.label).toMatch(/^\[Canvas/);
  });
});
