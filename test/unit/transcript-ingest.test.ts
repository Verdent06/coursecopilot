import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { disabledEmbedder } from "../../src/ingest/embed.js";
import { ingestTranscriptSource } from "../../src/ingest/sources/transcript.js";
import { HybridSearch } from "../../src/retrieve/hybrid.js";
import { openMemory } from "../helpers/memory-db.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("transcript ingest (VTT/SRT)", () => {
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

  it("ingests a local VTT with timestamp locators searchable as transcript citations", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "Automata", course_id: "auto-s11" });
    const dir = mkdtempSync(join(tmpdir(), "cc-vtt-"));
    temps.push(dir);
    const vttPath = join(dir, "lecture.vtt");
    writeFileSync(vttPath, readFileSync(join(fixtures, "sample.vtt")));
    const source = repo.insertSource({
      id: "src-vtt",
      course_id: "auto-s11",
      kind: "transcript",
      uri: vttPath,
    });
    const result = await ingestTranscriptSource({ repo, allowLocalPaths: true }, source.id);
    expect(result.docs).toBe(1);
    const chunks = repo.listChunksForCourse("auto-s11");
    const loc = JSON.parse(chunks[0]?.locator_json ?? "{}") as { start_s?: number; path?: string };
    expect(loc.start_s).toBe(0);
    expect(loc.path?.startsWith("file://")).toBe(true);

    const search = new HybridSearch(repo, disabledEmbedder(), false);
    const found = await search.search({
      query: "pumping lemma is not regular",
      course_id: "auto-s11",
      k: 3,
    });
    expect(found.results[0]?.citation.kind).toBe("transcript");
    expect(found.results[0]?.citation.label).toMatch(/\d+:\d{2}/);
    expect(found.results[0]?.citation.start_s).toBeGreaterThanOrEqual(0);
  });

  it("ingests SRT and remote HTTP transcripts (mocked fetch)", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const dir = mkdtempSync(join(tmpdir(), "cc-srt-"));
    temps.push(dir);
    const srtPath = join(dir, "lecture.srt");
    writeFileSync(srtPath, readFileSync(join(fixtures, "sample.srt")));
    const local = repo.insertSource({
      id: "src-srt",
      course_id: "x",
      kind: "transcript",
      uri: srtPath,
    });
    const localResult = await ingestTranscriptSource({ repo, allowLocalPaths: true }, local.id);
    expect(localResult.docs).toBe(1);
    expect(repo.listChunksForCourse("x").some((c) => /DFA/i.test(c.text))).toBe(true);

    const remote = repo.insertSource({
      id: "src-http",
      course_id: "x",
      kind: "transcript",
      uri: "https://example.edu/exports/lecture.vtt",
    });
    const vtt = readFileSync(join(fixtures, "sample.vtt"), "utf8");
    const httpResult = await ingestTranscriptSource(
      {
        repo,
        allowLocalPaths: false,
        fetch: async () =>
          new Response(vtt, { status: 200, headers: { "content-type": "text/vtt" } }),
      },
      remote.id,
    );
    expect(httpResult.docs).toBe(1);
  });

  it("refuses local transcripts when allowLocalPaths is false", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const dir = mkdtempSync(join(tmpdir(), "cc-deny-"));
    temps.push(dir);
    const path = join(dir, "a.vtt");
    writeFileSync(path, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhi\n");
    const source = repo.insertSource({
      id: "src-deny",
      course_id: "x",
      kind: "transcript",
      uri: path,
    });
    await expect(
      ingestTranscriptSource({ repo, allowLocalPaths: false }, source.id),
    ).rejects.toThrow(/--allow-path/);
  });
});
