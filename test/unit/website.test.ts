import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashEmbedder } from "../../src/ingest/embed.js";
import { IngestQueue } from "../../src/ingest/queue.js";
import { ingestWebsiteSource } from "../../src/ingest/sources/website.js";
import { HybridSearch } from "../../src/retrieve/hybrid.js";
import { writeFixtureSite } from "../helpers/fixture-site.js";
import { openMemory } from "../helpers/memory-db.js";
import { serveDirectory } from "../helpers/static-server.js";

describe("website crawler", () => {
  const temps: string[] = [];
  const closers: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0)) {
      await close();
    }
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ingests HTML+PDF+PPTX, skips robots/login/zip/mailto/off-site, and re-syncs with 0 re-embeds", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 3760", course_id: "eecs3760" });

    const dir = mkdtempSync(join(tmpdir(), "cc-site-"));
    temps.push(dir);
    await writeFixtureSite(dir);
    const server = await serveDirectory(dir);
    closers.push(() => server.close());

    const source = repo.insertSource({
      id: "src-web",
      course_id: "eecs3760",
      kind: "website",
      uri: `${server.baseUrl}/`,
      config_json: JSON.stringify({ max_depth: 3, max_pages: 50 }),
    });

    const inner = hashEmbedder();
    let embedTexts = 0;
    const embedder = {
      ...inner,
      async embed(texts: string[]) {
        embedTexts += texts.length;
        return inner.embed(texts);
      },
    };

    const queue = new IngestQueue({
      repo,
      embedder,
      crawlDelayMs: 0,
      allowPrivateNetwork: true,
    });
    const jobId = queue.submit(source.id);
    await queue.waitForIdle();
    const job = repo.getJob(jobId);
    expect(job?.state).toBe("done");

    const firstEmbeds = embedTexts;
    expect(firstEmbeds).toBeGreaterThan(0);

    const docs = repo.listChunksForCourse("eecs3760");
    const urls = new Set(
      (
        opened.db.prepare("SELECT url FROM documents WHERE source_id = ?").all(source.id) as Array<{
          url: string;
        }>
      ).map((r) => r.url),
    );
    expect(urls.size).toBe(7);
    expect([...urls].some((u) => u.endsWith("/notes.html"))).toBe(true);
    expect([...urls].some((u) => u.endsWith("/files/lec07.pdf"))).toBe(true);
    expect([...urls].some((u) => u.endsWith("/files/slides.pptx"))).toBe(true);

    const status = repo.listIngestStatus({ job_id: jobId })[0];
    expect(status?.docs).toBe(7);
    const reasons = (status?.skipped ?? []).map((s) => `${s.reason} ${s.url}`);
    expect(reasons.some((r) => r.includes("robots.txt disallow") && r.includes("/private/"))).toBe(
      true,
    );
    expect(reasons.some((r) => r.includes("requires login") && r.includes("login.html"))).toBe(
      true,
    );
    expect(reasons.some((r) => r.includes("archive") && r.includes("pack.zip"))).toBe(true);
    expect(reasons.some((r) => r.includes("calendar"))).toBe(true);
    expect(reasons.some((r) => r.includes("mailto"))).toBe(true);
    expect(reasons.some((r) => r.includes("out of scope") && r.includes("example.com"))).toBe(true);

    const pumping = docs.find((c) => /pumping lemma web notes/i.test(c.text));
    expect(pumping).toBeTruthy();
    const loc = JSON.parse(pumping?.locator_json ?? "{}") as { url?: string; anchor?: string };
    expect(loc.url).toMatch(/\/notes\.html$/);
    expect(loc.anchor).toBe("pumping-lemma");

    const pdfChunk = docs.find((c) => {
      const parsed = JSON.parse(c.locator_json) as { url?: string; page?: number };
      return parsed.page === 14 && (parsed.url ?? "").includes("lec07.pdf");
    });
    expect(pdfChunk).toBeTruthy();
    const pdfLoc = JSON.parse(pdfChunk?.locator_json ?? "{}") as { url?: string; page?: number };
    expect(pdfLoc.url).toMatch(/lec07\.pdf$/);
    expect(pdfLoc.page).toBe(14);

    expect(job?.message ?? "").toMatch(/Midterm/);

    const search = new HybridSearch(repo, embedder, opened.vecEnabled);
    const hits = await search.search({
      course_id: "eecs3760",
      query: "pumping lemma web notes",
      k: 5,
    });
    expect(hits.results.length).toBeGreaterThan(0);
    const webHit = hits.results.find((r) => /notes\.html#pumping-lemma/.test(r.citation.url));
    expect(webHit?.citation.kind).toBe("web");
    expect(webHit?.citation.anchor).toBe("pumping-lemma");
    const pdfHits = await search.search({
      course_id: "eecs3760",
      query: "proof that a^n b^n is not regular",
      k: 5,
    });
    const pdfHit = pdfHits.results.find((r) => r.citation.kind === "pdf");
    expect(pdfHit?.citation.url).toMatch(/lec07\.pdf#page=14/);

    const embedsBeforeSync = embedTexts;
    const syncIds = [queue.submit(source.id)];
    await queue.waitForIdle();
    expect(embedTexts).toBe(embedsBeforeSync);
    const syncJob = repo.getJob(syncIds[0] ?? "");
    expect(syncJob?.state).toBe("done");
    expect(syncJob?.message ?? "").toMatch(/unchanged/);
    expect(repo.countDocuments(source.id)).toBe(7);
  });

  it("refuses a non-http seed", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const source = repo.insertSource({
      id: "src-bad",
      course_id: "x",
      kind: "website",
      uri: "ftp://example.com/course",
    });
    await expect(ingestWebsiteSource({ repo, delayMs: 0 }, source.id)).rejects.toThrow(/http/);
  });
});
