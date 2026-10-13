import { afterEach, describe, expect, it } from "vitest";
import { disabledEmbedder } from "../../src/ingest/embed.js";
import { sha256 } from "../../src/ingest/hash.js";
import { persistExtractedDocument } from "../../src/ingest/persist.js";
import { IngestQueue } from "../../src/ingest/queue.js";
import { ingestLeccapSource } from "../../src/ingest/sources/leccap.js";
import { extractPdf } from "../../src/ingest/sources/pdf.js";
import { HybridSearch } from "../../src/retrieve/hybrid.js";
import { FIXTURE_RK, FIXTURE_SITE, fakeLeccapClient } from "../helpers/fake-leccap.js";
import { openMemory } from "../helpers/memory-db.js";
import { buildSimplePdf, LEC07_PAGES } from "../helpers/sample-files.js";

describe("leccap ingest", () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    for (const close of closers.splice(0)) {
      close();
    }
  });

  it("indexes a site's recordings with timestamp + slide locators and lecture citations", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });
    const source = repo.insertSource({
      id: "src-lc",
      course_id: "eecs376-f26",
      kind: "leccap",
      uri: `https://leccap.engin.umich.edu/leccap/site/${FIXTURE_SITE}`,
    });
    const result = await ingestLeccapSource(
      { repo, client: fakeLeccapClient(), ocr: null },
      source.id,
    );
    expect(result.docs).toBe(2);
    expect(result.chunks).toBeGreaterThanOrEqual(2);
    const chunks = repo.listChunksForCourse("eecs376-f26");
    expect(chunks.some((c) => /pumping/i.test(c.text))).toBe(true);
    const loc = JSON.parse(chunks[0]?.locator_json ?? "{}") as {
      recording_id?: string;
      slide?: number;
      start_s?: number;
      url?: string;
    };
    expect(loc.recording_id).toBe(FIXTURE_RK);
    expect(loc.slide).toBeGreaterThanOrEqual(1);
    expect(loc.url).toContain("/leccap/player/r/abc123");

    const search = new HybridSearch(repo, disabledEmbedder(), false);
    const found = await search.search({
      query: "pumping lemma a to the n b to the n is not regular",
      course_id: "eecs376-f26",
      k: 3,
      source_kinds: ["leccap"],
    });
    expect(found.results[0]?.citation.kind).toBe("lecture");
    expect(found.results[0]?.citation.label).toMatch(/EECS 376/);
    expect(found.results[0]?.citation.label).toMatch(/Lecture 10\/12/);
    expect(found.results[0]?.citation.label).toMatch(/slide /);
    expect(found.results[0]?.citation.url).toMatch(
      /^https:\/\/leccap\.engin\.umich\.edu\/leccap\/player\/r\/abc123/,
    );
    expect(found.results[0]?.citation.slide).not.toBeNull();
  });

  it("skips unchanged recordings on a second ingest (incremental)", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });
    const source = repo.insertSource({
      id: "src-lc",
      course_id: "eecs376-f26",
      kind: "leccap",
      uri: `https://leccap.engin.umich.edu/leccap/site/${FIXTURE_SITE}`,
    });
    const first = await ingestLeccapSource(
      { repo, client: fakeLeccapClient(), ocr: null },
      source.id,
    );
    expect(first.docs).toBe(2);
    expect((first.newChunkIds ?? []).length).toBeGreaterThan(0);
    const second = await ingestLeccapSource(
      { repo, client: fakeLeccapClient(), ocr: null },
      source.id,
    );
    expect(second.docs).toBe(2);
    expect(second.unchanged).toBe(2);
    expect(second.newChunkIds).toEqual([]);
    expect(repo.listSourceDocuments(source.id)).toHaveLength(2);
  });

  it("OCRs slides and names the matching course PDF in the citation", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });
    const pdfSource = repo.insertSource({
      id: "src-pdf",
      course_id: "eecs376-f26",
      kind: "file",
      uri: "file:///tmp/lec07.pdf",
    });
    const pdfBytes = new Uint8Array(buildSimplePdf(LEC07_PAGES, { landscape: true }));
    const extracted = await extractPdf(pdfBytes, "file:///tmp/lec07.pdf", "/tmp/lec07.pdf", {
      asSlides: true,
    });
    persistExtractedDocument(repo, {
      sourceId: pdfSource.id,
      courseId: "eecs376-f26",
      url: "file:///tmp/lec07.pdf",
      extracted,
      contentHash: sha256(pdfBytes),
    });

    const lc = repo.insertSource({
      id: "src-lc",
      course_id: "eecs376-f26",
      kind: "leccap",
      uri: "https://leccap.engin.umich.edu/leccap/player/r/abc123",
    });
    const ocr = async () =>
      "Proof that a^n b^n is not regular. Assume for contradiction that L is regular. Let p be the pumping length.";
    await ingestLeccapSource({ repo, client: fakeLeccapClient(), ocr }, lc.id);

    const lcChunks = repo
      .listChunksForCourse("eecs376-f26")
      .map((c) => JSON.parse(c.locator_json) as { pdf_title?: string; recording_id?: string })
      .filter((l) => l.recording_id);
    expect(lcChunks.some((l) => /lec07\.pdf/i.test(l.pdf_title ?? ""))).toBe(true);

    const search = new HybridSearch(repo, disabledEmbedder(), false);
    const found = await search.search({
      query: "pumping lemma proof a n b n is not regular",
      course_id: "eecs376-f26",
      k: 5,
      source_kinds: ["leccap"],
    });
    const hit = found.results.find((r) => r.citation.kind === "lecture");
    expect(hit?.citation.label).toMatch(/lec07\.pdf/i);
    expect(hit?.text).toMatch(/\[Slide /);
  });

  it("fails with login instructions when the session is expired", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });
    const source = repo.insertSource({
      id: "src-lc",
      course_id: "eecs376-f26",
      kind: "leccap",
      uri: "https://leccap.engin.umich.edu/leccap/player/r/abc123",
    });
    await expect(
      ingestLeccapSource(
        { repo, client: fakeLeccapClient({ expired: true }), ocr: null },
        source.id,
      ),
    ).rejects.toThrow(/login leccap/i);
  });

  it("runs through the ingest queue", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });
    const source = repo.insertSource({
      id: "src-q",
      course_id: "eecs376-f26",
      kind: "leccap",
      uri: "https://leccap.engin.umich.edu/leccap/player/r/abc123",
    });
    const queue = new IngestQueue({
      repo,
      embedder: disabledEmbedder(),
      leccap: fakeLeccapClient(),
    });
    const jobId = queue.submit(source.id);
    await queue.waitForIdle();
    const job = repo.listIngestStatus({ job_id: jobId })[0];
    expect(job?.state).toBe("done");
    expect((job?.docs ?? 0) >= 1).toBe(true);
  });
});
