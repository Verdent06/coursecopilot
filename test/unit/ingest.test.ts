import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RepoError } from "../../src/db/repo.js";
import { IngestQueue } from "../../src/ingest/queue.js";
import { ingestFileSource } from "../../src/ingest/sources/file.js";
import { openMemory } from "../helpers/memory-db.js";
import { writeSampleFolder } from "../helpers/sample-files.js";

describe("file / folder ingest", () => {
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

  it("ingests a folder of PDF, PPTX, MD, TXT; skips binaries and dotfiles", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "EECS 376", course_id: "eecs376-f26" });
    const dir = mkdtempSync(join(tmpdir(), "cc-folder-"));
    temps.push(dir);
    const sample = await writeSampleFolder(dir);

    const source = repo.insertSource({
      id: "src1",
      course_id: "eecs376-f26",
      kind: "folder",
      uri: sample.dir,
    });
    const result = await ingestFileSource({ repo, allowLocalPaths: true }, source.id);
    expect(result.docs).toBe(4);
    expect(result.chunks).toBeGreaterThanOrEqual(4);
    expect(result.skipped.some((s) => s.reason.includes("unsupported"))).toBe(true);

    const chunks = repo.listChunksForCourse("eecs376-f26");
    const locators = chunks.map(
      (c) => JSON.parse(c.locator_json) as { page?: number; slide?: number },
    );
    expect(locators.some((l) => l.page === 1)).toBe(true);
    expect(locators.some((l) => l.page === 2)).toBe(true);
    expect(locators.some((l) => l.slide === 1)).toBe(true);
    expect(locators.some((l) => l.slide === 2)).toBe(true);
    expect(chunks.some((c) => /pumping lemma/i.test(c.text))).toBe(true);
    expect(chunks.some((c) => /Office hours/i.test(c.text))).toBe(true);
    expect(chunks.some((c) => /hidden/i.test(c.text))).toBe(false);
  });

  it("ingests a single PDF file source with page locators", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const dir = mkdtempSync(join(tmpdir(), "cc-file-"));
    temps.push(dir);
    const sample = await writeSampleFolder(dir);
    const source = repo.insertSource({
      id: "src-pdf",
      course_id: "x",
      kind: "file",
      uri: sample.pdf,
    });
    const result = await ingestFileSource({ repo, allowLocalPaths: true }, source.id);
    expect(result.docs).toBe(1);
    const chunks = repo.listChunksForCourse("x");
    expect(
      chunks.every((c) => (JSON.parse(c.locator_json) as { page?: number }).page != null),
    ).toBe(true);
  });

  it("job queue returns immediately and finishes with done", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const dir = mkdtempSync(join(tmpdir(), "cc-q-"));
    temps.push(dir);
    writeFileSync(join(dir, "n.md"), "# Hello\n\nIndexed markdown.");
    const source = repo.insertSource({
      id: "src-q",
      course_id: "x",
      kind: "folder",
      uri: dir,
    });
    const queue = new IngestQueue({ repo });
    const jobId = queue.submit(source.id);
    expect(jobId.startsWith("job_")).toBe(true);
    expect(repo.getJob(jobId)?.state).toBe("queued");
    await queue.waitForIdle();
    expect(repo.getJob(jobId)?.state).toBe("done");
    expect(repo.getSource(source.id)?.status).toBe("done");
    const status = repo.listIngestStatus({ job_id: jobId });
    expect(status[0]?.docs).toBe(1);
    expect(status[0]?.chunks).toBeGreaterThanOrEqual(1);
  });

  it("rejects relative paths", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const source = repo.insertSource({
      id: "src-rel",
      course_id: "x",
      kind: "file",
      uri: "notes.pdf",
    });
    await expect(ingestFileSource({ repo, allowLocalPaths: true }, source.id)).rejects.toThrow(
      RepoError,
    );
  });

  it("refuses local paths when allowLocalPaths is false", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const dir = mkdtempSync(join(tmpdir(), "cc-deny-"));
    temps.push(dir);
    writeFileSync(join(dir, "n.md"), "hello");
    const source = repo.insertSource({
      id: "src-deny",
      course_id: "x",
      kind: "file",
      uri: join(dir, "n.md"),
    });
    await expect(ingestFileSource({ repo, allowLocalPaths: false }, source.id)).rejects.toThrow(
      /--allow-path/,
    );
  });

  it("remove_source deletes chunks", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const dir = mkdtempSync(join(tmpdir(), "cc-rm-"));
    temps.push(dir);
    writeFileSync(join(dir, "n.md"), "# T\n\nbody text for the chunk.");
    const source = repo.insertSource({
      id: "src-rm",
      course_id: "x",
      kind: "file",
      uri: join(dir, "n.md"),
    });
    await ingestFileSource({ repo, allowLocalPaths: true }, source.id);
    expect(repo.listChunksForCourse("x").length).toBeGreaterThan(0);
    const removed = repo.removeSource(source.id);
    expect(removed.removed_chunks).toBeGreaterThan(0);
    expect(repo.listChunksForCourse("x")).toHaveLength(0);
    expect(repo.getSource(source.id)).toBeUndefined();
  });
});
