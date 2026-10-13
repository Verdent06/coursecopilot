import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NO_CAPTIONS_FALLBACK } from "../../src/ingest/config.js";
import { disabledEmbedder } from "../../src/ingest/embed.js";
import { IngestQueue } from "../../src/ingest/queue.js";
import { ingestYoutubeSource } from "../../src/ingest/sources/youtube.js";
import { createYoutubeClient } from "../../src/ingest/youtube/client.js";
import { HybridSearch } from "../../src/retrieve/hybrid.js";
import { FIXTURE_VIDEO_ID, fakeYoutubeClient } from "../helpers/fake-youtube.js";
import { openMemory } from "../helpers/memory-db.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/youtube");

describe("YouTube ingest", () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    for (const close of closers.splice(0)) {
      close();
    }
  });

  it("indexes a video with timestamp locators and youtu.be deep links", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "Automata", course_id: "auto-s11" });
    const source = repo.insertSource({
      id: "src-yt",
      course_id: "auto-s11",
      kind: "youtube",
      uri: `https://www.youtube.com/watch?v=${FIXTURE_VIDEO_ID}`,
    });
    const result = await ingestYoutubeSource({ repo, youtube: fakeYoutubeClient() }, source.id);
    expect(result.docs).toBe(1);
    expect(result.chunks).toBeGreaterThanOrEqual(1);
    const chunks = repo.listChunksForCourse("auto-s11");
    const loc = JSON.parse(chunks[0]?.locator_json ?? "{}") as {
      video_id?: string;
      start_s?: number;
      url?: string;
    };
    expect(loc.video_id).toBe(FIXTURE_VIDEO_ID);
    expect(loc.start_s).toBe(0);
    expect(loc.url).toContain(FIXTURE_VIDEO_ID);

    const search = new HybridSearch(repo, disabledEmbedder(), false);
    const found = await search.search({
      query: "pumping lemma a to the n b to the n is not regular",
      course_id: "auto-s11",
      k: 3,
    });
    expect(found.results[0]?.citation.kind).toBe("youtube");
    expect(found.results[0]?.citation.url).toMatch(/^https:\/\/youtu\.be\/abcdefghijk\?t=\d+s$/);
    expect(found.results[0]?.citation.label).toMatch(/\d+:\d{2}/);
    expect(found.results[0]?.citation.start_s).not.toBeNull();
  });

  it("expands a playlist, skips videos without captions, and can be partial", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "Automata", course_id: "auto-s11" });
    const source = repo.insertSource({
      id: "src-pl",
      course_id: "auto-s11",
      kind: "youtube",
      uri: "https://www.youtube.com/playlist?list=PLtestplaylist1xx",
    });
    const result = await ingestYoutubeSource({ repo, youtube: fakeYoutubeClient() }, source.id);
    expect(result.docs).toBe(2);
    expect(result.skipped.some((s) => s.reason.includes("No captions"))).toBe(true);
    expect(result.errors).toBeGreaterThanOrEqual(1);
    const chunks = repo.listChunksForCourse("auto-s11");
    expect(chunks.some((c) => /pumping lemma/i.test(c.text))).toBe(true);
    expect(chunks.some((c) => /DFA/i.test(c.text))).toBe(true);
  });

  it("reports the Whisper / VTT fallback when a video has no captions", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const source = repo.insertSource({
      id: "src-none",
      course_id: "x",
      kind: "youtube",
      uri: "https://youtu.be/nolangtrack",
    });
    const result = await ingestYoutubeSource({ repo, youtube: fakeYoutubeClient() }, source.id);
    expect(result.docs).toBe(0);
    expect(result.skipped[0]?.reason).toContain("transcript");
    expect(result.skipped[0]?.reason).toContain("Whisper");
    expect(NO_CAPTIONS_FALLBACK).toMatch(/Whisper/);
  });

  it("falls back to yt-dlp when Innertube/HTML have no tracks", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const source = repo.insertSource({
      id: "src-dlp",
      course_id: "x",
      kind: "youtube",
      uri: `https://youtu.be/${FIXTURE_VIDEO_ID}`,
    });

    const xml = readFileSync(join(fixtureDir, "captions.xml"), "utf8");
    const ytdlpJson = readFileSync(join(fixtureDir, "ytdlp-video.json"), "utf8");
    const client = createYoutubeClient({
      async fetch(url: string) {
        const href = String(url);
        if (href.includes("youtubei/v1/player")) {
          return new Response(JSON.stringify({ playabilityStatus: { status: "OK" } }), {
            status: 200,
          });
        }
        if (href.includes("watch?v=")) {
          return new Response("<html><body>no captions here</body></html>", { status: 200 });
        }
        if (href.includes("timedtext")) {
          return new Response(xml, { status: 200 });
        }
        if (href.includes("oembed")) {
          return new Response(readFileSync(join(fixtureDir, "oembed.json"), "utf8"), {
            status: 200,
          });
        }
        return new Response("nope", { status: 404 });
      },
      async runYtDlp() {
        return { stdout: ytdlpJson, stderr: "", code: 0 };
      },
    });

    const result = await ingestYoutubeSource({ repo, youtube: client }, source.id);
    expect(result.docs).toBe(1);
    expect(repo.listChunksForCourse("x")[0]?.text).toMatch(/pumping lemma/i);
  });

  it("queue submits a youtube job that finishes done", async () => {
    const { opened, repo } = openMemory();
    closers.push(() => opened.db.close());
    repo.addCourse({ title: "X", course_id: "x" });
    const source = repo.insertSource({
      id: "src-q",
      course_id: "x",
      kind: "youtube",
      uri: `https://www.youtube.com/watch?v=${FIXTURE_VIDEO_ID}`,
    });
    const queue = new IngestQueue({ repo, youtube: fakeYoutubeClient(), embedder: null });
    const jobId = queue.submit(source.id);
    await queue.waitForIdle();
    expect(repo.getJob(jobId)?.state).toBe("done");
    expect(repo.getSource(source.id)?.status).toBe("done");
  });
});
